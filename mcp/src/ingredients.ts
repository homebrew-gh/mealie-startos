/**
 * Turning free-text ingredient lines into Mealie's structured ingredients
 * (quantity + unit + food), and store sections (Mealie "labels") for foods.
 *
 * Mealie only sorts a shopping list by aisle when each item is linked to a
 * food that has a label, and a recipe's ingredients only link to foods once
 * they have been run through the ingredient parser. Recipes created through
 * the API skip that step, so the connector runs it itself.
 */
import { mealie } from './mealie.js'
import { splitLines } from './split.js'

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

  async resolve(item: Named | null | undefined): Promise<Named | null> {
    if (!item?.name?.trim()) return null
    if (item.id) return item
    const key = norm(item.name)
    const hit = this.cache.get(key)
    if (hit) return hit
    const found = await mealie('GET', `/${this.kind}`, {
      query: { search: item.name, perPage: 50 },
    })
    let match: Named | undefined = (found.items ?? []).find(
      (x: any) =>
        norm(x.name) === key ||
        (x.pluralName && norm(x.pluralName) === key) ||
        (x.abbreviation && norm(x.abbreviation) === key),
    )
    if (!match) {
      match = await mealie('POST', `/${this.kind}`, {
        body: { name: item.name.trim() },
      })
      this.created.push(item.name.trim())
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
  for (const p of parsed) {
    const food = await foods.resolve(p.food)
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
  }
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
  pieces.forEach((p, k) => {
    const n = linked.ingredients[k]
    const t = todo[p.from]
    const list = replacements.get(t.index) ?? []
    // The first piece keeps the original ingredient's other fields (such as
    // its referenceId); extra pieces are new ingredients.
    const base = list.length ? {} : t.ing
    list.push({
      ...base,
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
  const saved = await mealie('PATCH', `/recipes/${encodeURIComponent(slug)}`, {
    body: { recipeIngredient: next },
  })
  return {
    slug,
    parser,
    parsed: todo.length,
    splitLines: pieces.length - todo.length || undefined,
    createdFoods: linked.createdFoods,
    createdUnits: linked.createdUnits,
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

/** Finds a food by name or id, or creates it. */
export async function findOrCreateFood(nameOrId: string) {
  if (/^[0-9a-f-]{36}$/i.test(nameOrId)) {
    return mealie('GET', `/foods/${nameOrId}`)
  }
  const food = await new Resolver('foods').resolve({ name: nameOrId })
  return mealie('GET', `/foods/${food!.id}`)
}
