/**
 * Food-name normalization, core-food extraction, fuzzy-match validation,
 * alias-aware lookup, and duplicate food detection.
 *
 * Kept pure (no Mealie HTTP imports) so it can be unit-tested directly and
 * mirrored cleanly in the YesChef Android app.
 */

export type FoodLike = {
  id?: string | null
  name: string
  pluralName?: string | null
  abbreviation?: string | null
  aliases?: { name?: string | null }[] | null
  labelId?: string | null
  label?: { id?: string | null; name?: string | null } | null
}

export type UnitLike = {
  id?: string | null
  name?: string | null
  pluralName?: string | null
  abbreviation?: string | null
}

/** Units to strip from a line even when the parser read the unit differently. */
const COMMON_UNITS = [
  'fluid ounce', 'fl oz', 'tablespoon', 'teaspoon', 'kilogram', 'milliliter',
  'millilitre', 'package', 'bottle', 'handful', 'gallon', 'jigger', 'splash',
  'bundle', 'bunch', 'clove', 'ounce', 'pound', 'quart', 'slice', 'piece',
  'sprig', 'stick', 'pinch', 'stalk', 'head', 'liter', 'litre', 'pint', 'tbsp',
  'drop', 'dash', 'part', 'shot', 'gram', 'cup', 'tsp', 'tbs', 'can', 'jar',
  'pkg', 'bag', 'box', 'oz', 'lb', 'kg', 'ml', 'qt', 'pt', 'g', 'l',
]

/** Leading size/prep/cut/state words that should not become part of a food's name. */
const LEADING_PREP_WORDS = new Set([
  'large', 'medium', 'small', 'big', 'jumbo', 'extra', 'whole', 'ripe',
  'fresh', 'freshly', 'finely', 'roughly', 'thinly', 'coarsely', 'lightly',
  'chopped', 'diced', 'minced', 'sliced', 'shredded', 'grated', 'crushed',
  'peeled', 'cubed', 'halved', 'quartered', 'trimmed', 'rinsed', 'drained',
  'melted', 'softened', 'beaten', 'divided', 'seeded', 'cored', 'julienned',
  'boneless', 'skinless', 'pitted', 'deveined', 'cooked', 'uncooked', 'raw',
  'chilled', 'cold', 'warm', 'hot', 'room', 'temperature', 'heaping', 'level',
  'packed', 'optional', 'organic', 'natural', 'pure', 'local', 'quality',
])

/**
 * Qualifiers that do not change what food an ingredient is when matching against
 * an existing Mealie food with the same head noun (e.g. "unsalted butter" -> "butter",
 * "extra-virgin olive oil" -> "olive oil", "kosher salt" -> "salt").
 *
 * Deliberately excludes colors and flavor/source modifiers ("peanut", "chicken",
 * "simple", "maple", "coconut", "brown", "red", "black") so distinct foods like
 * "peanut butter" vs "butter" or "simple syrup" vs "maple syrup" are never conflated.
 */
const HARMLESS_QUALIFIERS = new Set([
  'organic', 'natural', 'pure', 'local', 'raw', 'unbleached', 'unenriched',
  'plain', 'unflavored', 'unsweetened', 'unsalted', 'salted', 'kosher',
  'fine', 'coarse', 'flaky', 'table', 'iodized', 'extra', 'virgin',
  'cold', 'pressed', 'expeller', 'low', 'reduced', 'sodium', 'fat', 'free',
  'nonfat', 'lean', 'grass', 'fed', 'pasture', 'raised', 'wild', 'caught',
  'italian', 'flat', 'leaf', 'curly', 'english', 'persian', 'fresh', 'dried',
])

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Conservative English singularizer for food words (keeps hummus, asparagus, swiss, etc.). */
export function singularWord(w: string): string {
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2)
  if (/(?:ch|sh|x|z)es$/.test(w) && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

/** Canonical comparison key: lowercase, punctuation/hyphens collapsed, head noun singularized. */
export function normalizeFoodKey(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[-–—/.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  const tokens = cleaned.split(' ')
  tokens[tokens.length - 1] = singularWord(tokens[tokens.length - 1])
  return tokens.join(' ')
}

/** All normalized keys under which a Mealie food can match (name, plural, abbreviation, aliases). */
export function foodKeys(food: FoodLike): string[] {
  const raw: (string | null | undefined)[] = [
    food.name,
    food.pluralName,
    food.abbreviation,
    ...(food.aliases ?? []).map((a) => a?.name),
  ]
  const out = new Set<string>()
  for (const s of raw) {
    if (!s?.trim()) continue
    const k = normalizeFoodKey(s)
    if (k) out.add(k)
  }
  return [...out]
}

/**
 * Extracts the core food phrase from a free-text ingredient line by stripping
 * quantities, units, parentheticals, notes, and leading prep/size modifiers.
 */
export function extractCoreFood(
  input: string,
  note?: string | null,
  unit?: UnitLike | null,
): string | undefined {
  let t = input.trim().toLowerCase()
  if (!t) return undefined
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  const normNote = note?.trim().toLowerCase() ?? ''
  if (normNote && t.includes(normNote)) {
    // Only strip the note when it isn't the entire line.
    const without = t.replace(normNote, ' ').trim()
    if (without.replace(/[,;\s]+/g, '')) t = without
  }
  t = t.split(/[,;]/)[0]
  t = t.replace(/^[\s\d./\-–—¼½¾⅓⅔⅛⅜⅝⅞]+/, ' ').trim()
  t = t.replace(/^(?:a|an)\s+/, '')

  const unitNames = [
    unit?.name,
    unit?.pluralName,
    unit?.abbreviation,
    ...COMMON_UNITS,
  ]
    .filter((n): n is string => typeof n === 'string' && Boolean(n.trim()))
    .map((n) => n.trim().toLowerCase())
    .sort((a, b) => b.length - a.length)

  for (const u of unitNames) {
    const m = t.match(new RegExp(`^${escapeRe(u)}(?:s|es)?\\.?(\\s+|$)`))
    if (m) {
      t = t.slice(m[0].length)
      break
    }
  }
  t = t.replace(/^of\s+/, '').replace(/\s+/g, ' ').trim()

  // Strip leading size/prep/cut words, always keeping at least one token.
  const words = t.split(' ').filter(Boolean)
  while (words.length > 1) {
    const w = words[0].replace(/^-+|-+$/g, '')
    if (w === 'room' && words[1] === 'temperature' && words.length > 2) {
      words.splice(0, 2)
      continue
    }
    if (LEADING_PREP_WORDS.has(w)) {
      words.shift()
      continue
    }
    break
  }
  t = words.join(' ').trim()
  if (!t || words.length > 5 || !/^[a-z][a-z' -]*$/.test(t)) return undefined
  return t
}

/**
 * Checks whether a Mealie food matched by the parser genuinely represents the
 * ingredient line, guarding against fuzzy mismatches ("simple syrup" -> "maple syrup",
 * "peanut butter" -> "butter", "chicken broth" -> "chicken", "olive oil" -> "olive")
 * while honoring Mealie aliases, plurals, hyphens, and safe qualifiers
 * ("unsalted butter" -> "butter", "extra-virgin olive oil" -> "olive oil").
 */
export function isGoodFoodMatch(
  input: string,
  food: FoodLike,
  note?: string | null,
  unit?: UnitLike | null,
): boolean {
  const keys = foodKeys(food)
  if (!keys.length) return false

  const core = extractCoreFood(input, note, unit)
  if (!core) {
    // Couldn't extract cleanly; fall back to whole-word containment on the line.
    const lineKey = normalizeFoodKey(input)
    return keys.some((k) => {
      const re = new RegExp(`(^| )${escapeRe(k)}( |$)`)
      return re.test(lineKey)
    })
  }

  const coreKey = normalizeFoodKey(core)
  if (keys.includes(coreKey)) return true

  const coreTokens = coreKey.split(' ')
  const coreHead = coreTokens[coreTokens.length - 1]

  for (const fk of keys) {
    const foodTokens = fk.split(' ')
    const foodHead = foodTokens[foodTokens.length - 1]
    // Head nouns must agree ("broth" != "chicken", "oil" != "olive", "juice" != "lime").
    if (foodHead !== coreHead) continue

    // Case 1: food is a narrower suffix/subset of core (e.g. "unsalted butter" -> "butter").
    // Every extra word in core must be a harmless qualifier.
    if (foodTokens.every((t) => coreTokens.includes(t))) {
      const foodSet = new Set(foodTokens)
      const extras = coreTokens.filter((t) => !foodSet.has(t))
      if (extras.every((e) => HARMLESS_QUALIFIERS.has(e))) return true
    }

    // Case 2: core is a narrower subset of food with only harmless qualifiers on food
    // (e.g. "olive oil" -> "extra virgin olive oil").
    if (coreTokens.every((t) => foodTokens.includes(t))) {
      const coreSet = new Set(coreTokens)
      const extras = foodTokens.filter((t) => !coreSet.has(t))
      if (extras.every((e) => HARMLESS_QUALIFIERS.has(e))) return true
    }
  }

  return false
}

/**
 * Returns the line's own cleaned food phrase when the parser's matched food fails
 * `isGoodFoodMatch`, or undefined when the match is acceptable or can't be extracted.
 */
export function ownFoodTextForLine(
  input: string,
  food: FoodLike,
  note?: string | null,
  unit?: UnitLike | null,
): string | undefined {
  if (isGoodFoodMatch(input, food, note, unit)) return undefined
  return extractCoreFood(input, note, unit)
}

/**
 * Finds the best existing food in `foods` matching `name` (by exact normalized name,
 * pluralName, abbreviation, or alias). Prefers exact case-insensitive name matches first.
 */
export function findFoodInList<T extends FoodLike>(
  name: string,
  foods: T[],
): T | undefined {
  const exactLower = name.trim().toLowerCase()
  if (!exactLower) return undefined
  const direct = foods.find(
    (f) =>
      f.name.trim().toLowerCase() === exactLower ||
      (f.pluralName && f.pluralName.trim().toLowerCase() === exactLower) ||
      (f.abbreviation && f.abbreviation.trim().toLowerCase() === exactLower) ||
      (f.aliases ?? []).some(
        (a) => a?.name && a.name.trim().toLowerCase() === exactLower,
      ),
  )
  if (direct) return direct

  const targetKey = normalizeFoodKey(name)
  if (!targetKey) return undefined
  return foods.find((f) => foodKeys(f).includes(targetKey))
}

/**
 * Groups likely duplicate foods in Mealie (same normalized singular/hyphenated key,
 * or differing only by harmless qualifiers like "organic" / "unsalted").
 */
export function findDuplicateFoodGroups<T extends FoodLike>(
  foods: T[],
): { key: string; reason: 'exact_normalized' | 'qualifier_variant'; foods: T[] }[] {
  const byNorm = new Map<string, T[]>()
  for (const f of foods) {
    const k = normalizeFoodKey(f.name)
    if (!k) continue
    const list = byNorm.get(k) ?? []
    list.push(f)
    byNorm.set(k, list)
  }

  const results: {
    key: string
    reason: 'exact_normalized' | 'qualifier_variant'
    foods: T[]
  }[] = []
  const groupedIds = new Set<string>()

  for (const [key, list] of byNorm) {
    if (list.length > 1) {
      results.push({ key, reason: 'exact_normalized', foods: list })
      list.forEach((f) => f.id && groupedIds.add(f.id))
    }
  }

  // Also detect qualifier-only variants (e.g. "butter" & "unsalted butter", "garlic" & "fresh garlic").
  const byStripped = new Map<string, T[]>()
  for (const f of foods) {
    const k = normalizeFoodKey(f.name)
    if (!k) continue
    const tokens = k.split(' ')
    const stripped = tokens
      .filter((t, i) => i === tokens.length - 1 || !HARMLESS_QUALIFIERS.has(t))
      .join(' ')
    if (!stripped) continue
    const list = byStripped.get(stripped) ?? []
    list.push(f)
    byStripped.set(stripped, list)
  }
  for (const [key, list] of byStripped) {
    if (list.length <= 1) continue
    // Skip if every member was already in the same exact_normalized group.
    const distinctNorms = new Set(list.map((f) => normalizeFoodKey(f.name)))
    if (distinctNorms.size <= 1) continue
    results.push({ key, reason: 'qualifier_variant', foods: list })
  }

  return results.sort((a, b) => a.key.localeCompare(b.key))
}
