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

/** Finds a food or unit by exact name (case-insensitive), or creates it. */
class Resolver {
  private cache = new Map<string, Named>()
  created: string[] = []
  constructor(private kind: 'foods' | 'units') {}

  /** An existing food or unit with exactly this name, plural or abbreviation. */
  async findExact(name: string): Promise<Named | undefined> {
    const key = norm(name)
    const found = await mealie('GET', `/${this.kind}`, {
      query: { search: name, perPage: 50 },
    })
    return (found.items ?? []).find(
      (x: any) =>
        norm(x.name) === key ||
        (x.pluralName && norm(x.pluralName) === key) ||
        (x.abbreviation && norm(x.abbreviation) === key),
    )
  }

  async resolve(item: Named | null | undefined): Promise<Named | null> {
    if (!item?.name?.trim()) return null
    if (item.id) return item
    const key = norm(item.name)
    const hit = this.cache.get(key)
    if (hit) return hit
    let match = await this.findExact(item.name)
    if (!match) {
      const r = await createOrReuse<Named>(
        () =>
          mealie('POST', `/${this.kind}`, { body: { name: item.name.trim() } }),
        () => this.findExact(item.name),
      )
      match = r.value
      if (r.created) this.created.push(item.name.trim())
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
    // back as "maple syrup". If the matched food's name isn't in the line,
    // use the line's own food words, matched exactly or created.
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

/** Units to strip from a line even when the parser read the unit differently. */
const COMMON_UNITS = [
  'teaspoon', 'tablespoon', 'tsp', 'tbsp', 'tbs', 'cup', 'ounce', 'oz',
  'fluid ounce', 'fl oz', 'pound', 'lb', 'gram', 'g', 'kilogram', 'kg',
  'milliliter', 'millilitre', 'ml', 'liter', 'litre', 'l', 'pinch', 'dash',
  'splash', 'clove', 'can', 'jar', 'bottle', 'package', 'pkg', 'slice',
  'piece', 'bunch', 'sprig', 'stick', 'handful', 'part', 'shot', 'jigger',
  'drop', 'quart', 'qt', 'pint', 'pt', 'gallon',
]

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The food words of an ingredient line, when the parser linked it to a food
 * whose name isn't in the line at all (a fuzzy match). Undefined when the
 * match is fine or the words can't be picked out cleanly.
 */
export function ownFoodText(p: ParsedLine, food: Named): string | undefined {
  const line = norm(p.input)
  const names = [food.name, food.pluralName as string | undefined]
    .filter((n): n is string => Boolean(n && n.trim()))
    .map(norm)
  if (names.some((n) => line.includes(n))) return undefined
  let t = line.replace(/\([^)]*\)/g, ' ')
  const note = p.note ? norm(p.note) : ''
  if (note && t.includes(note)) t = t.replace(note, ' ')
  t = t.split(',')[0]
  t = t.replace(/^[\s\d./\-–¼½¾⅓⅔⅛⅜⅝⅞]+/, ' ').trim()
  t = t.replace(/^(a|an)\s+/, '')
  const unitNames = [
    p.unit?.name,
    p.unit?.pluralName,
    p.unit?.abbreviation,
    ...COMMON_UNITS,
  ]
    .filter((n): n is string => typeof n === 'string' && Boolean(n.trim()))
    .map(norm)
    .sort((a, b) => b.length - a.length)
  for (const u of unitNames) {
    const m = t.match(new RegExp(`^${escapeRe(u)}(s|es)?\\.?(\\s+|$)`))
    if (m) {
      t = t.slice(m[0].length)
      break
    }
  }
  t = t.replace(/^of\s+/, '').replace(/\s+/g, ' ').trim()
  if (!t || t.split(' ').length > 5 || !/^[a-z][a-z' -]*$/.test(t)) {
    return undefined
  }
  return t
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
