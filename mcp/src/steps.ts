/**
 * Structured recipe instructions (`title`, `summary`, `text`, `ingredientReferences`),
 * ingredient `referenceId` preservation across edits, and recipe completeness signals
 * so agents and the YesChef app stay in sync.
 */
import { randomUUID } from 'node:crypto'
import * as z from 'zod/v4'

export const instructionEntry = z.union([
  z.string(),
  z.object({
    text: z.string().describe('Instruction text for this step'),
    title: z
      .string()
      .optional()
      .describe('Optional section heading above this step, e.g. "Make the sauce"'),
    summary: z
      .string()
      .optional()
      .describe(
        'Short label for this step (used on timers and cook notes), e.g. "Sear the steak"',
      ),
    ingredients: z
      .array(z.number().int().min(0))
      .optional()
      .describe(
        "0-based indexes into the flattened ingredients list for ONLY the ingredients actually measured, prepped, or added in this step (do not count section headers). Sets Mealie's ingredientReferences so YesChef's \"You'll need\" box is exact. Omit or pass [] for steps that don't introduce or prep anything new (preheating, simmering, flipping, baking, resting, slicing/serving already-cooked food).",
      ),
  }),
])

export type InstructionEntry = z.infer<typeof instructionEntry>

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Plain text of a stored Mealie ingredient line. */
export function rawIngredientText(ing: any): string {
  return String(ing?.originalText || ing?.display || ing?.note || '').trim()
}

/**
 * Ensures every ingredient object has a `referenceId` so steps can safely point at it.
 * Returns new objects only for lines that were missing one.
 */
export function ensureIngredientReferenceIds(
  ingredients: any[],
  makeId: () => string = randomUUID,
): any[] {
  return ingredients.map((ing) =>
    ing?.referenceId ? ing : { ...ing, referenceId: makeId() },
  )
}

/**
 * Builds the updated `recipeIngredient` array for `update_recipe`, preserving
 * `referenceId` and existing parsed fields (food, unit, quantity, note) for lines
 * whose text did not change. New or edited lines get a fresh `referenceId` and are
 * left unlinked so `parseRecipe` parses only them.
 */
export function mergeUpdatedIngredients(
  existing: any[],
  lines: string[],
  titles: (string | undefined)[],
  makeId: () => string = randomUUID,
): any[] {
  const pool = existing.map((ing, i) => ({
    ing,
    index: i,
    keys: new Set(
      [ing?.display, ing?.originalText, ing?.note]
        .filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
        .map(norm),
    ),
    used: false,
  }))

  return lines.map((line, i) => {
    const key = norm(line)
    const match = pool.find((p) => !p.used && key && p.keys.has(key))
    if (match) {
      match.used = true
      return {
        ...match.ing,
        referenceId: match.ing.referenceId || makeId(),
        title: titles[i] ?? '',
      }
    }
    return {
      referenceId: makeId(),
      note: line,
      originalText: line,
      display: line,
      title: titles[i] ?? '',
    }
  })
}

/**
 * Converts MCP instruction entries (strings or structured objects) into Mealie's
 * `recipeInstructions` payload, resolving 0-based `ingredients` indexes against
 * `recipeIngredients`'s `referenceId`s.
 */
export function buildMealieInstructions(
  entries: InstructionEntry[],
  recipeIngredients: any[],
  existingSteps: any[] = [],
  makeId: () => string = randomUUID,
): { instructions: any[]; invalidIndexes: number[] } {
  const invalidIndexes: number[] = []
  const instructions = entries.map((entry, idx) => {
    const prev = existingSteps[idx]
    const id = prev?.id || makeId()
    if (typeof entry === 'string') {
      return {
        id,
        title: '',
        summary: '',
        text: entry,
        ingredientReferences: [],
      }
    }
    const seen = new Set<string>()
    const refs: { referenceId: string }[] = []
    for (const ingIndex of entry.ingredients ?? []) {
      const refId = recipeIngredients[ingIndex]?.referenceId
      if (!refId) {
        invalidIndexes.push(ingIndex)
        continue
      }
      if (!seen.has(refId)) {
        seen.add(refId)
        refs.push({ referenceId: refId })
      }
    }
    return {
      id,
      title: entry.title?.trim() ?? '',
      summary: entry.summary?.trim() ?? '',
      text: entry.text,
      ingredientReferences: refs,
    }
  })
  return { instructions, invalidIndexes }
}

/**
 * Removes any step `ingredientReferences` whose `referenceId` is no longer present
 * in `recipeIngredients` (prevents orphaned references after editing ingredients).
 * Returns `undefined` when nothing changed.
 */
export function pruneOrphanedStepReferences(
  steps: any[],
  recipeIngredients: any[],
): any[] | undefined {
  const valid = new Set(
    recipeIngredients
      .map((i) => i?.referenceId)
      .filter((id): id is string => Boolean(id)),
  )
  let changed = false
  const next = steps.map((step) => {
    const refs: any[] = step?.ingredientReferences ?? []
    const kept = refs.filter((r) => r?.referenceId && valid.has(r.referenceId))
    if (kept.length === refs.length) return step
    changed = true
    return { ...step, ingredientReferences: kept }
  })
  return changed ? next : undefined
}

/**
 * When a combined ingredient line ("salt and pepper, to taste") is split into
 * multiple ingredients during parsing, any step referencing the original line's
 * `referenceId` also receives the new pieces' `referenceId`s.
 * Returns `undefined` when no step needed updating.
 */
export function propagateSplitStepReferences(
  steps: any[],
  extraRefsByOriginal: Map<string, string[]>,
): any[] | undefined {
  if (!extraRefsByOriginal.size || !steps.length) return undefined
  let changed = false
  const next = steps.map((step) => {
    const refs: any[] = step?.ingredientReferences ?? []
    if (!refs.length) return step
    const seen = new Set<string>(
      refs.map((r) => r?.referenceId).filter(Boolean),
    )
    const added: { referenceId: string }[] = []
    for (const r of refs) {
      const extras = extraRefsByOriginal.get(r?.referenceId)
      if (!extras) continue
      for (const extraId of extras) {
        if (!seen.has(extraId)) {
          seen.add(extraId)
          added.push({ referenceId: extraId })
        }
      }
    }
    if (!added.length) return step
    changed = true
    return { ...step, ingredientReferences: [...refs, ...added] }
  })
  return changed ? next : undefined
}

/**
 * Formats Mealie's `recipeInstructions` for agent readability, turning
 * `ingredientReferences` back into 0-based `ingredients` indexes matching the
 * recipe's `ingredients` array.
 */
export function formatInstructions(
  steps: any[] | undefined,
  ingredients: any[] | undefined,
) {
  const indexByRef = new Map<string, number>()
  ;(ingredients ?? []).forEach((ing, i) => {
    if (ing?.referenceId) indexByRef.set(ing.referenceId, i)
  })
  return (steps ?? []).map((s, index) => {
    const linked = (s?.ingredientReferences ?? [])
      .map((r: any) => indexByRef.get(r?.referenceId))
      .filter((n: number | undefined): n is number => n !== undefined)
      .sort((a: number, b: number) => a - b)
    const uniqueLinked = [...new Set(linked)]
    return {
      index,
      title: s?.title?.trim() || undefined,
      summary: s?.summary?.trim() || undefined,
      text: s?.text ?? '',
      ingredients: uniqueLinked.length ? uniqueLinked : undefined,
    }
  })
}

/**
 * Parses a leading positive serving count from yield text ("4 servings", "6",
 * "Makes 8 portions") so Mealie's numeric `recipeServings` stays in sync with
 * `recipeYield` (used by YesChef's servings scaler).
 */
export function parseServingsNumber(servings: string | undefined): number | undefined {
  if (!servings) return undefined
  const m = servings.trim().match(/^(?:makes|serves)?\s*(\d+(?:\.\d+)?)\b/i)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Deduplicated linked foods on a recipe that have no store section (label) yet. */
export function unlabeledFoodsForRecipe(
  recipe: any,
  labels: { id?: string | null; name: string }[],
): { id: string; name: string }[] {
  const seen = new Set<string>()
  const out: { id: string; name: string }[] = []
  for (const ing of recipe?.recipeIngredient ?? []) {
    const food = ing?.food
    if (!food?.id || seen.has(food.id)) continue
    const hasSection = Boolean(
      food.label?.name ||
        (food.labelId && labels.some((l) => l.id === food.labelId)),
    )
    if (!hasSection) {
      seen.add(food.id)
      out.push({ id: food.id, name: food.name })
    }
  }
  return out
}

/**
 * Summarizes missing recipe metadata that affects Mealie shopping lists or
 * YesChef's cookbook and live-cooking timeline.
 */
export function recipeGaps(
  recipe: any,
  opts: { unlabeledFoodsCount: number; hasNutrition: boolean },
): string[] {
  const gaps: string[] = []
  if (!(recipe.recipeCategory ?? []).length) gaps.push('missing_category')
  if (!recipe.prepTime?.trim()) gaps.push('missing_prep_time')
  if (!recipe.performTime?.trim() && !recipe.cookTime?.trim()) {
    gaps.push('missing_cook_time')
  }
  if (!recipe.image) gaps.push('missing_image')
  if (!opts.hasNutrition) gaps.push('missing_nutrition')
  const unlinked = (recipe.recipeIngredient ?? []).filter(
    (i: any) => !i.food?.id && rawIngredientText(i),
  ).length
  if (unlinked) {
    gaps.push(`${unlinked}_unlinked_ingredient${unlinked === 1 ? '' : 's'}`)
  }
  if (opts.unlabeledFoodsCount) {
    gaps.push(
      `${opts.unlabeledFoodsCount}_unlabeled_food${opts.unlabeledFoodsCount === 1 ? '' : 's'}`,
    )
  }
  const steps: any[] = recipe.recipeInstructions ?? []
  const ingredients: any[] = recipe.recipeIngredient ?? []
  if (
    steps.length > 0 &&
    ingredients.length > 0 &&
    steps.every((s) => !(s?.ingredientReferences ?? []).length)
  ) {
    gaps.push('missing_step_ingredient_links')
  }
  return gaps
}

/** Timeline subject written when recipe changes are logged after reviewing cook notes. */
export const RECIPE_UPDATE_SUBJECT = 'Recipe updated'

export function isRecipeUpdateEvent(e: {
  subject?: string | null
  eventType?: string | null
}): boolean {
  return (e.subject ?? '').trim().toLowerCase() === RECIPE_UPDATE_SUBJECT.toLowerCase()
}

export type TimelineEventWithDate = {
  recipeId: string
  eventType?: string | null
  subject?: string | null
  eventMessage?: string | null
  at: Date
}

/**
 * Groups cooking notes by day and recipe, marking each group `reviewed` when a
 * newer "Recipe updated" timeline event exists for that recipe, or `pending`
 * otherwise. Pass events scanned from newest down to `start` (including events
 * after `end`) so a review recorded after `until` still marks earlier cooks.
 */
export function groupCookNotes(
  events: TimelineEventWithDate[],
  opts: {
    start: Date
    end: Date
    onlyRecipeId?: string
    onlyPending?: boolean
    dayOf: (d: Date) => string
  },
) {
  const latestReview = new Map<string, Date>()
  const noteEvents: TimelineEventWithDate[] = []

  for (const e of events) {
    if (opts.onlyRecipeId && e.recipeId !== opts.onlyRecipeId) continue
    if (isRecipeUpdateEvent(e)) {
      const prev = latestReview.get(e.recipeId)
      if (!prev || e.at > prev) latestReview.set(e.recipeId, e.at)
      continue
    }
    if (e.at < opts.start || e.at >= opts.end) continue
    if (e.eventType !== 'comment') continue
    if (!String(e.eventMessage ?? '').trim()) continue
    noteEvents.push(e)
  }

  const groups = new Map<
    string,
    {
      day: string
      recipeId: string
      latestNoteAt: Date
      notes: { at: string; subject?: string; text: string }[]
    }
  >()
  for (const e of noteEvents) {
    const day = opts.dayOf(e.at)
    const key = `${day} ${e.recipeId}`
    let g = groups.get(key)
    if (!g) {
      g = { day, recipeId: e.recipeId, latestNoteAt: e.at, notes: [] }
      groups.set(key, g)
    } else if (e.at > g.latestNoteAt) {
      g.latestNoteAt = e.at
    }
    g.notes.push({
      at: e.at.toISOString(),
      subject: e.subject || undefined,
      text: String(e.eventMessage).trim(),
    })
  }

  const result = [...groups.values()].map((g) => {
    const reviewedAt = latestReview.get(g.recipeId)
    const reviewed = Boolean(reviewedAt && reviewedAt > g.latestNoteAt)
    return {
      day: g.day,
      recipeId: g.recipeId,
      status: reviewed ? ('reviewed' as const) : ('pending' as const),
      reviewedAt: reviewed ? reviewedAt!.toISOString() : undefined,
      notes: g.notes.reverse(),
    }
  })

  return opts.onlyPending
    ? result.filter((g) => g.status === 'pending')
    : result
}
