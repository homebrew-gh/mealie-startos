/**
 * Recipe categories and tags (Mealie "organizers"), looked up by name and
 * created when missing, in the {id, name, slug} shape a recipe stores.
 */
import { createOrReuse, mealie } from './mealie.js'

export type OrganizerKind = 'categories' | 'tags'
export type Organizer = { id: string; name: string; slug: string }

/**
 * The scheme the YesChef app sorts the cookbook by. Assistants are asked to
 * follow it so recipes land in the app's chapters and filters.
 */
export const ORGANIZING_SCHEME =
  'Use one category per recipe as its cookbook chapter: Mains, Sides, Soups & Salads, Breakfast, Desserts, Baking, Starters & Snacks, Drinks, Sauces & Basics. ' +
  'Use tags for protein (Chicken, Beef, Pork, Lamb, Turkey, Seafood, Vegetarian, Vegan) and cooking style (Quick, Slow cooker, Grill, One pot, Make ahead, Weeknight, Freezer friendly). ' +
  'Reuse these exact names, and check list_organizers before inventing new ones.'

const norm = (s: string) => s.trim().toLowerCase()

export async function listOrganizers(kind: OrganizerKind) {
  const r = await mealie('GET', `/organizers/${kind}`, {
    query: { perPage: -1, orderBy: 'name', orderDirection: 'asc' },
  })
  return (r.items ?? []) as (Organizer & { recipeCount?: number })[]
}

/**
 * Resolves names to existing organizers (matching name or slug, ignoring
 * case), creating the ones that don't exist yet.
 */
export async function resolveOrganizers(kind: OrganizerKind, names: string[]) {
  const wanted = new Map<string, string>()
  for (const n of names) {
    const key = norm(n)
    if (key && !wanted.has(key)) wanted.set(key, n.trim())
  }
  if (!wanted.size)
    return { organizers: [] as Organizer[], created: [] as string[] }
  const existing = await listOrganizers(kind)
  const organizers: Organizer[] = []
  const created: string[] = []
  for (const [key, name] of wanted) {
    let hit = existing.find((o) => norm(o.name) === key || norm(o.slug) === key)
    if (!hit) {
      const r = await createOrReuse<Organizer>(
        () => mealie('POST', `/organizers/${kind}`, { body: { name } }),
        async () =>
          (await listOrganizers(kind)).find(
            (o) => norm(o.name) === key || norm(o.slug) === key,
          ),
      )
      hit = r.value
      if (r.created) created.push(name)
    }
    organizers.push({ id: hit!.id, name: hit!.name, slug: hit!.slug })
  }
  return { organizers, created }
}
