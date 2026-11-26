/**
 * Turning free-text ingredient lines into Mealie's structured ingredients
 * (quantity + unit + food), and store sections (Mealie "labels") for foods.
 *
 * Mealie only sorts a shopping list by aisle when each item is linked to a
 * food that has a label, and a recipe's ingredients only link to foods once
 * they have been run through the ingredient parser. Recipes created through
 * the API skip that step, so the connector runs it itself.
 */
import { randomUUID } from 'node:crypto'
import { createOrReuse, mealie } from './mealie.js'
import { splitLines } from './split.js'
import { propagateSplitStepReferences } from './steps.js'
import {
  type FoodLike,
  findFoodInList,
  normalizeFoodKey,
  ownFoodTextForLine,
} from './foodMatch.js'

export type Parser = 'openai' | 'nlp' | 'brute'

type Named = { id?: string | null; name: string; [k: string]: unknown }

export type ParsedLine = {
  input: string
  confidence?: number
  quantity: number
  unit?: Named | null
  food?: Named | null
  note: string
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Parse lines with Mealie's parser. 'openai' uses the AI provider set in
 * Mealie's group settings and falls back to the built-in NLP parser if no
 * provider is set up or the call fails.
 */
export async function parseLines(
  lines: string[],
  parser: Parser = 'openai',
): Promise<{ parser: Parser; lines: ParsedLine[] }> {
  if (!lines.length) return { parser, lines: [] }
  let used = parser
  let result: any[]
  try {
    result = await mealie('POST', '/parser/ingredients', {
      body: { parser, ingredients: lines },
    })
  } catch (err) {
    if (parser !== 'openai') throw err
    used = 'nlp'
    result = await mealie('POST', '/parser/ingredients', {
      body: { parser: 'nlp', ingredients: lines },
    })
  }
  return {
    parser: used,
    lines: result.map((p: any, i: number) => ({
      input: p.input ?? lines[i],
      confidence: p.confidence?.average ?? undefined,
      quantity: p.ingredient?.quantity ?? 0,
      unit: p.ingredient?.unit ?? null,
      food: p.ingredient?.food ?? null,
      note: p.ingredient?.note ?? '',
    })),
  }
}

/**
 * Finds a food or unit by normalized name, plural, abbreviation, or alias
 * (loading Mealie's catalog once per resolver), or creates it.
 */
class Resolver {
  private catalog?: Named[]
  private cache = new Map<string, Named>()
  created: string[] = []
  constructor(private kind: 'foods' | 'units') {}

  private async loadCatalog(force = false): Promise<Named[]> {
    if (!this.catalog || force) {
      const r = await mealie('GET', `/${this.kind}`, {
        query: { perPage: -1 },
      })
      this.catalog = (r.items ?? []) as Named[]
    }
    return this.catalog!
  }

  /** An existing food or unit matching by name, plural, abbreviation, or alias. */
  async findExact(name: string, forceReload = false): Promise<Named | undefined> {
    const all = await this.loadCatalog(forceReload)
    return findFoodInList(name, all as (Named & FoodLike)[])
  }

  /** Resolves an item by id (refreshing from catalog when present) or by name/alias, creating if missing. */
  async resolve(
    item: Named | null | undefined,
    opts: { createIfMissing?: boolean } = {},
  ): Promise<Named | null> {
    if (!item?.name?.trim() && !item?.id) return null
    const createIfMissing = opts.createIfMissing ?? true
    if (item.id) {
      const all = await this.loadCatalog()
      return all.find((x) => x.id === item.id) ?? item
    }
    const key = normalizeFoodKey(item.name) || norm(item.name)
    const hit = this.cache.get(key)
    if (hit) return hit
    let match = await this.findExact(item.name)
    if (!match) {
      if (!createIfMissing) return null
      const r = await createOrReuse<Named>(
        () =>
          mealie('POST', `/${this.kind}`, { body: { name: item.name.trim() } }),
        () => this.findExact(item.name, true),
      )
      match = r.value
      if (r.created) {
        this.created.push(item.name.trim())
        this.catalog?.push(match!)
      }
    }
    this.cache.set(key, match!)
    return match!
  }
}

/**
 * Links parsed lines to Mealie foods and units, creating any that don't exist
 * yet, and returns them in the shape of a recipe's `recipeIngredient` list.
 */
export async function toRecipeIngredients(parsed: ParsedLine[]) {
  const foods = new Resolver('foods')
  const units = new Resolver('units')
  const ingredients = []
  const rematchedFoods: { input: string; parserFood: string; food: string }[] =
    []
  for (const p of parsed) {
    let food = await foods.resolve(p.food)
    // The parser fuzzy-matches to existing foods, so "simple syrup" can come
    // back as "maple syrup" or "peanut butter" as "butter". Validate against
    // the food's name/plural/aliases and head noun; if it fails, resolve or
    // create the line's own cleaned food phrase instead.
    const own = food?.id ? ownFoodText(p, food) : undefined
    if (own) {
      const exact = await foods.resolve({ name: own })
      if (exact && exact.id !== food!.id) {
        rematchedFoods.push({ input: p.input, parserFood: food!.name, food: exact.name })
        food = exact
      }
    }
    const unit = await units.resolve(p.unit)
    ingredients.push({
      quantity: p.quantity ?? 0,
      unit: unit ? { id: unit.id, name: unit.name } : null,
      food: food ? { id: food.id, name: food.name } : null,
      note: p.note ?? '',
      originalText: p.input,
      display: '',
    })
  }
  return {
    ingredients,
    createdFoods: foods.created,
    createdUnits: units.created,
    rematchedFoods,
  }
}

/**
 * The food words of an ingredient line, when the parser linked it to a food
 * that does not genuinely match the line (fuzzy mismatch). Undefined when the
 * match is valid (including aliases, plurals, and safe qualifiers) or the words
 * cannot be picked out cleanly.
 */
export function ownFoodText(p: ParsedLine, food: Named): string | undefined {
  return ownFoodTextForLine(p.input, food as FoodLike, p.note, p.unit)
}

/** The text to re-parse for an ingredient already stored on a recipe. */
export function ingredientText(i: any): string {
  return (i.originalText || i.display || i.note || '').trim()
}

/** Parse and link a recipe's ingredients, then save them on the recipe. */
export async function parseRecipe(
  slug: string,
  opts: { parser?: Parser; onlyUnlinked?: boolean } = {},
) {
  const recipe = await mealie('GET', `/recipes/${encodeURIComponent(slug)}`)
  const current: any[] = recipe.recipeIngredient ?? []
  const onlyUnlinked = opts.onlyUnlinked ?? true
  const todo = current
    .map((ing, index) => ({ ing, index, text: ingredientText(ing) }))
    .filter(({ ing, text }) => text && !(onlyUnlinked && ing.food?.id))
  if (!todo.length) {
    return {
      slug,
      parser: null,
      parsed: 0,
      createdFoods: [],
      createdUnits: [],
      recipe,
    }
  }
  // One food per line: "salt and pepper, to taste" becomes two ingredients.
  const pieces = splitLines(todo.map((t) => t.text))
  const { parser, lines } = await parseLines(
    pieces.map((p) => p.text),
    opts.parser,
  )
  const linked = await toRecipeIngredients(lines)
  const replacements = new Map<number, any[]>()
  const extraRefsByOriginal = new Map<string, string[]>()
  pieces.forEach((p, k) => {
    const n = linked.ingredients[k]
    const t = todo[p.from]
    const list = replacements.get(t.index) ?? []
    // The first piece keeps the original ingredient's other fields (such as
    // its referenceId); extra pieces get new referenceIds and propagate to any
    // step that referenced the original line.
    const isExtra = list.length > 0
    const base = isExtra ? {} : t.ing
    const extraRefId = isExtra ? randomUUID() : undefined
    if (extraRefId && t.ing.referenceId) {
      const extras = extraRefsByOriginal.get(t.ing.referenceId) ?? []
      extras.push(extraRefId)
      extraRefsByOriginal.set(t.ing.referenceId, extras)
    }
    list.push({
      ...base,
      ...(extraRefId ? { referenceId: extraRefId } : {}),
      quantity: n.quantity,
      unit: n.unit,
      food: n.food,
      note: n.note,
      originalText: n.originalText,
      display: '',
    })
    replacements.set(t.index, list)
  })
  const next = current.flatMap((ing, index) => replacements.get(index) ?? [ing])
  const updatedInstructions = propagateSplitStepReferences(
    recipe.recipeInstructions ?? [],
    extraRefsByOriginal,
  )
  const saved = await mealie('PATCH', `/recipes/${encodeURIComponent(slug)}`, {
    body: {
      recipeIngredient: next,
      ...(updatedInstructions ? { recipeInstructions: updatedInstructions } : {}),
    },
  })
  return {
    slug,
    parser,
    parsed: todo.length,
    splitLines: pieces.length - todo.length || undefined,
    createdFoods: linked.createdFoods,
    createdUnits: linked.createdUnits,
    rematchedFoods: linked.rematchedFoods.length
      ? linked.rematchedFoods
      : undefined,
    lowConfidence: lines
      .filter((l) => l.confidence !== undefined && l.confidence < 0.6)
      .map((l) => l.input),
    recipe: saved,
  }
}

// ---------------- Store sections (labels) ----------------

export async function listLabels(): Promise<Named[]> {
  const r = await mealie('GET', '/groups/labels', { query: { perPage: -1 } })
  return r.items ?? []
}

/** Finds a label by name (case-insensitive), or creates it. */
export async function findOrCreateLabel(name: string) {
  const key = norm(name)
  const existing = (await listLabels()).find((l) => norm(l.name) === key)
  if (existing) return { label: existing, created: false }
  const label = await mealie('POST', '/groups/labels', {
    body: { name: name.trim() },
  })
  return { label, created: true }
}

/** Finds a food by name or id, or creates it, and says which it did. */
export async function findOrCreateFood(nameOrId: string) {
  if (/^[0-9a-f-]{36}$/i.test(nameOrId)) {
    return { food: await mealie('GET', `/foods/${nameOrId}`), created: false }
  }
  const resolver = new Resolver('foods')
  const food = await resolver.resolve({ name: nameOrId })
  return {
    food: await mealie('GET', `/foods/${food!.id}`),
    created: resolver.created.length > 0,
  }
}

/** A food's store section name, from its label or the label list. */
export function sectionName(food: any, labels: Named[]): string | undefined {
  if (food?.label?.name) return food.label.name
  if (!food?.labelId) return undefined
  return labels.find((l) => l.id === food.labelId)?.name
}
