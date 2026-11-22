/**
 * Mealie's ingredient parser expects one food per line, so a line such as
 * "salt and pepper, to taste" comes back as one unknown food. This splits such
 * lines into one line per food, each keeping the shared note, before parsing.
 *
 * It is deliberately conservative: it only splits short, quantity-free lists
 * of foods, and leaves alone foods whose name contains "and" (half and half,
 * mac and cheese, ...) and anything it isn't sure about.
 */

/** Foods whose names contain "and" / "&"; never split these. */
const COMPOUND_FOODS = [
  'half and half',
  'mac and cheese',
  'macaroni and cheese',
  'salt and vinegar',
  'sweet and sour',
  'sweet and spicy',
  'hot and sour',
  'bread and butter',
  'peanut butter and jelly',
  'cookies and cream',
  'fish and chips',
  'surf and turf',
  'franks and beans',
  'pork and beans',
  'beans and franks',
  'rice and beans',
  'red beans and rice',
  'chips and salsa',
  'oil and vinegar',
  'cream and sugar',
  'cheese and crackers',
  'pb and j',
]

/** Trailing notes shared by every food in the list. */
const NOTE_PHRASE_RE =
  /[\s,]+((?:to taste|as needed|as desired|optional|for (?:serving|garnish|garnishing|frying|greasing|topping|dipping))\.?)$/i

/** Words that make a segment a preparation note, not a food. */
const PREP_WORDS =
  /\b(diced|chopped|minced|sliced|peeled|grated|shredded|crushed|cubed|halved|quartered|softened|melted|beaten|divided|drained|rinsed|trimmed|seeded|cored|julienned|toasted|room temperature|finely|roughly|thinly)\b/i

/** A quantity or measurement at the start means it isn't a bare food list. */
const LEADING_QTY =
  /^\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|a\s+(?:pinch|dash|handful)|one|two|three|four|five|six)\b/i

const MAX_WORDS_PER_FOOD = 4

export function splitCombinedIngredient(line: string): string[] {
  const text = line.trim()
  if (!text || LEADING_QTY.test(text) || /[()]/.test(text)) return [line]
  const lower = text.toLowerCase().replace(/\s*&\s*/g, ' and ')
  if (COMPOUND_FOODS.some((f) => lower.includes(f))) return [line]

  // Separate the shared note: a known phrase such as "to taste", or else the
  // text after the last comma unless it continues the list ("salt, pepper
  // and paprika").
  let head = text
  let note = ''
  const phrase = text.match(NOTE_PHRASE_RE)
  if (phrase && phrase.index !== undefined) {
    head = text.slice(0, phrase.index).trim()
    note = phrase[1].replace(/\.$/, '')
  } else {
    const comma = text.lastIndexOf(',')
    if (comma >= 0) {
      const tail = text.slice(comma + 1).trim()
      const continuesList =
        /^(?:and|&)\s/i.test(tail) ||
        (/\s(?:and|&)\s/i.test(tail) && !PREP_WORDS.test(tail))
      if (!continuesList) {
        head = text.slice(0, comma).trim()
        note = tail
      }
    }
  }
  head = head.replace(/,\s*$/, '')

  const parts = head
    .split(/\s*,\s*(?:and\s+|&\s+)?|\s+(?:and|&)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return [line]
  const looksLikeFood = (p: string) =>
    p.split(/\s+/).length <= MAX_WORDS_PER_FOOD &&
    !PREP_WORDS.test(p) &&
    /^[a-z][a-z' -]*$/i.test(p)
  if (!parts.every(looksLikeFood)) return [line]
  return parts.map((p) => (note ? `${p}, ${note}` : p))
}

/** Splits every line, remembering which input line each piece came from. */
export function splitLines(lines: string[]) {
  const pieces: { text: string; from: number }[] = []
  lines.forEach((line, from) => {
    for (const text of splitCombinedIngredient(line))
      pieces.push({ text, from })
  })
  return pieces
}
