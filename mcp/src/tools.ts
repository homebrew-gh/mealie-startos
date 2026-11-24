import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { mealie } from './mealie.js'
import {
  findOrCreateFood,
  findOrCreateLabel,
  listLabels,
  ownFoodText,
  parseLines,
  parseRecipe,
  sectionName,
} from './ingredients.js'
import { splitLines } from './split.js'
import {
  listOrganizers,
  ORGANIZING_SCHEME,
  resolveOrganizers,
} from './organizers.js'

const parserArg = z
  .enum(['openai', 'nlp', 'brute'])
  .optional()
  .describe(
    "Mealie's ingredient parser. 'openai' (default) uses the AI provider set in Mealie and falls back to 'nlp' if none is set up.",
  )

const parseArg = z
  .boolean()
  .optional()
  .describe(
    "Run Mealie's ingredient parser so each ingredient is linked to a food and unit (default true). Linked foods are what lets shopping lists sort by store section.",
  )

/** Parse a just-saved recipe's ingredients; never fail the save over it. */
async function parseAfterSave(slug: string, parse: boolean | undefined) {
  if (parse === false)
    return { recipe: await mealie('GET', `/recipes/${slug}`) }
  try {
    const r = await parseRecipe(slug)
    return {
      recipe: r.recipe,
      parsing: {
        parser: r.parser,
        parsed: r.parsed,
        splitLines: r.splitLines,
        createdFoods: r.createdFoods,
        createdUnits: r.createdUnits,
        rematchedFoods: r.rematchedFoods,
        lowConfidence: r.lowConfidence,
      },
    }
  } catch (err) {
    return {
      recipe: await mealie('GET', `/recipes/${slug}`),
      parsing: { error: String((err as Error).message ?? err) },
    }
  }
}

/**
 * How YesChef cooks a whole meal: every recipe planned in the same slot (same
 * date and meal) goes into one cook timeline, scheduled from each recipe's
 * prep and cook times.
 */
const MEAL_GUIDANCE =
  'Keep each dish its own recipe: save a main and its sides as separate recipes, never merged into one, and put sides in the Sides category. ' +
  'To plan a meal, add the main and each side to the meal plan on the same date with the same entryType (for example all "dinner"); the YesChef app cooks everything in one slot as a single timeline. ' +
  'Set prepTime and cookTime on every recipe, because the timeline is scheduled from them.'

/**
 * ISO 8601 duration ("PT1H30M") to Mealie's stored text ("1 hour 30 minutes").
 * A zero duration (PT0M) becomes "0 minutes", so a no-cook recipe shows an
 * explicit zero rather than a blank that reads as "unknown".
 */
function isoToMealieTime(iso: string): string {
  const m = iso
    .trim()
    .match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
  if (!m || !m.slice(1).some(Boolean)) return iso.trim()
  const parts: string[] = []
  const add = (n: string | undefined, unit: string) => {
    const v = Number(n ?? 0)
    if (v) parts.push(`${v} ${unit}${v === 1 ? '' : 's'}`)
  }
  add(m[1], 'day')
  add(m[2], 'hour')
  add(m[3], 'minute')
  add(m[4], 'second')
  return parts.length ? parts.join(' ') : '0 minutes'
}

const durationArg = (what: string) =>
  z
    .string()
    .optional()
    .describe(
      `${what} as an ISO 8601 duration, e.g. PT15M or PT1H30M. Use PT0M for none (a no-cook sauce has cookTime PT0M).`,
    )

const categoriesArg = z
  .array(z.string())
  .optional()
  .describe(
    "Category names; replaces the recipe's categories. Missing ones are created. " +
      ORGANIZING_SCHEME,
  )

const tagsArg = z
  .array(z.string())
  .optional()
  .describe(
    "Tag names; replaces the recipe's tags. Missing ones are created. " +
      ORGANIZING_SCHEME,
  )

const SECTION_HELP =
  'An entry can also be a subheading with its ingredients, {"section": "Marinade", "ingredients": ["1/4 cup lime juice", ...]}, to group the lines that go into one part of the dish. Mix plain lines and sections in order; lines before the first section have no subheading.'

const ingredientEntry = z.union([
  z.string(),
  z.object({
    section: z.string().describe('Subheading, e.g. "Marinade" or "For the sauce"'),
    ingredients: z.array(z.string()),
  }),
])

type IngredientEntry = z.infer<typeof ingredientEntry>

/** Ingredient lines in order, with the subheading (Mealie's `title`) each one starts. */
function flattenIngredients(entries: IngredientEntry[]) {
  const lines: string[] = []
  const titles: (string | undefined)[] = []
  for (const e of entries) {
    if (typeof e === 'string') {
      lines.push(e)
      titles.push(undefined)
      continue
    }
    e.ingredients.forEach((line, k) => {
      lines.push(line)
      titles.push(k === 0 ? e.section.trim() || undefined : undefined)
    })
  }
  return { lines, titles }
}

/** The time fields of a PATCH body, from ISO 8601 durations. */
function timePatch(t: {
  prepTime?: string
  cookTime?: string
  totalTime?: string
}) {
  const patch: Record<string, string> = {}
  if (t.prepTime !== undefined) patch.prepTime = isoToMealieTime(t.prepTime)
  if (t.cookTime !== undefined) patch.performTime = isoToMealieTime(t.cookTime)
  if (t.totalTime !== undefined) patch.totalTime = isoToMealieTime(t.totalTime)
  return patch
}

/** Friendly nutrition names mapped to Mealie's fields, with the unit Mealie shows. */
const NUTRITION_FIELDS = {
  calories: ['calories', 'kcal'],
  protein: ['proteinContent', 'g'],
  carbs: ['carbohydrateContent', 'g'],
  fat: ['fatContent', 'g'],
  saturatedFat: ['saturatedFatContent', 'g'],
  transFat: ['transFatContent', 'g'],
  unsaturatedFat: ['unsaturatedFatContent', 'g'],
  fiber: ['fiberContent', 'g'],
  sugar: ['sugarContent', 'g'],
  sodium: ['sodiumContent', 'mg'],
  cholesterol: ['cholesterolContent', 'mg'],
} as const
type NutritionKey = keyof typeof NUTRITION_FIELDS
type Nutrition = Partial<Record<NutritionKey, number | null>>

const nutritionArg = z
  .object(
    Object.fromEntries(
      Object.entries(NUTRITION_FIELDS).map(([k, [, unit]]) => [
        k,
        z
          .number()
          .nonnegative()
          .nullable()
          .optional()
          .describe(`${unit} per serving; null clears it`),
      ]),
    ) as Record<NutritionKey, z.ZodOptional<z.ZodNullable<z.ZodNumber>>>,
  )
  .optional()
  .describe(
    'Nutrition facts per serving, as plain numbers (calories in kcal, sodium and cholesterol in mg, the rest in grams). Only the fields you pass change. Estimate from the ingredients and servings if no label is given, and say it is an estimate in the description or a note.',
  )

/**
 * The PATCH fields that set a recipe's nutrition: the current values merged
 * with the given ones, plus the setting that shows nutrition on the recipe.
 */
function nutritionPatch(current: any, n: Nutrition) {
  const nutrition: Record<string, string | null> = { ...(current.nutrition ?? {}) }
  for (const [k, v] of Object.entries(n)) {
    if (v === undefined) continue
    const field = NUTRITION_FIELDS[k as NutritionKey][0]
    nutrition[field] = v === null ? null : String(Math.round(v * 10) / 10)
  }
  return {
    nutrition,
    settings: { ...(current.settings ?? {}), showNutrition: true },
  }
}

function nutritionDetail(r: any) {
  const out: Record<string, number> = {}
  for (const [k, [field]] of Object.entries(NUTRITION_FIELDS)) {
    const v = parseFloat(r.nutrition?.[field])
    if (!Number.isNaN(v)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Sets a recipe's categories and/or tags by name, creating missing ones. */
async function setOrganizers(
  slug: string,
  categories: string[] | undefined,
  tags: string[] | undefined,
) {
  const patch: Record<string, unknown> = {}
  const created: { categories?: string[]; tags?: string[] } = {}
  if (categories) {
    const r = await resolveOrganizers('categories', categories)
    patch.recipeCategory = r.organizers
    if (r.created.length) created.categories = r.created
  }
  if (tags) {
    const r = await resolveOrganizers('tags', tags)
    patch.tags = r.organizers
    if (r.created.length) created.tags = r.created
  }
  if (!Object.keys(patch).length) return undefined
  await mealie('PATCH', `/recipes/${encodeURIComponent(slug)}`, {
    body: patch,
  })
  return created
}

/** When this household last made a recipe, or undefined. */
async function lastMade(slug: string): Promise<string | undefined> {
  try {
    const r = await mealie(
      'GET',
      `/households/self/recipes/${encodeURIComponent(slug)}`,
    )
    return r?.lastMade ?? undefined
  } catch {
    return undefined
  }
}

/** YYYY-MM-DD of a moment in the box's time zone. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A Mealie timestamp; ones without an offset are UTC. */
function eventTime(ts: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`)
}

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Date as YYYY-MM-DD')

const entryType = z
  .enum(['breakfast', 'lunch', 'dinner', 'side', 'snack', 'drink', 'dessert'])
  .describe(
    'Which meal of the day. Plan a side under the same meal as its main (e.g. "dinner"), not as "side", so they cook together.',
  )

const names = (xs: any[] | undefined) =>
  (xs ?? []).map((x) => x?.name).filter(Boolean)

function recipeSummary(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description || undefined,
    tags: names(r.tags),
    categories: names(r.recipeCategory),
    totalTime: r.totalTime || undefined,
    rating: r.rating ?? undefined,
  }
}

function recipeDetail(r: any) {
  return {
    ...recipeSummary(r),
    servings: r.recipeServings || undefined,
    yield: r.recipeYield || undefined,
    prepTime: r.prepTime || undefined,
    cookTime: r.performTime || r.cookTime || undefined,
    nutrition: nutritionDetail(r),
    ingredients: (r.recipeIngredient ?? []).map(
      (i: any) => i.display || i.originalText || i.note || '',
    ),
    unlinkedIngredients:
      (r.recipeIngredient ?? []).filter(
        (i: any) => !i.food?.id && (i.originalText || i.note),
      ).length || undefined,
    instructions: (r.recipeInstructions ?? []).map((s: any) =>
      s.title ? `${s.title}: ${s.text}` : s.text,
    ),
    notes: (r.notes ?? []).map((n: any) =>
      n.title ? `${n.title}: ${n.text}` : n.text,
    ),
    tools: names(r.tools),
    source: r.orgURL || undefined,
    hasImage: Boolean(r.image),
  }
}

/** How many recipes and shopping list items are linked to a food. */
async function foodUsage(foodId: string, items?: any[]) {
  const [r, all] = await Promise.all([
    mealie('GET', '/recipes', { query: { foods: [foodId], perPage: 50 } }),
    items ?? shoppingItems(),
  ])
  const recipes = (r.items ?? []).map((x: any) => x.slug as string)
  return {
    recipeCount: (r.total as number | undefined) ?? recipes.length,
    recipes,
    shoppingItemCount: all.filter((i: any) => (i.foodId ?? i.food?.id) === foodId)
      .length,
  }
}

async function shoppingItems(): Promise<any[]> {
  const r = await mealie('GET', '/households/shopping/items', {
    query: { perPage: -1 },
  })
  return r.items ?? []
}

/** A recipe's detail with each ingredient's linked food and store section. */
async function recipeWithLinks(r: any) {
  const labels = await listLabels()
  return {
    ...recipeDetail(r),
    ingredients: (r.recipeIngredient ?? []).map((i: any) => ({
      section: i.title || undefined,
      text: i.display || i.originalText || i.note || '',
      food: i.food?.id ? { id: i.food.id, name: i.food.name } : undefined,
      storeSection: i.food?.id ? sectionName(i.food, labels) : undefined,
    })),
  }
}

function itemSummary(i: any) {
  return {
    id: i.id,
    item: i.display || i.note || i.food?.name || '',
    quantity: i.quantity,
    checked: i.checked,
    storeSection: i.label?.name ?? undefined,
    food: i.food?.name ?? undefined,
  }
}

export function registerTools(server: McpServer) {
  // ---------------- Recipes ----------------
  server.registerTool(
    'search_recipes',
    {
      title: 'Search recipes',
      description:
        'Search the Mealie recipe collection by text (name, description, ingredients). Leave query empty to list recipes. Returns summaries; use get_recipe for the full recipe.',
      inputSchema: {
        query: z.string().optional().describe('Search text'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Only recipes with these tag slugs or ids'),
        categories: z
          .array(z.string())
          .optional()
          .describe('Only recipes in these category slugs or ids'),
        foods: z
          .array(z.string())
          .optional()
          .describe(
            'Only recipes with an ingredient linked to any of these food ids (from list_foods)',
          ),
        page: z.number().int().min(1).optional(),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Default 20'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, tags, categories, foods, page, perPage }) => {
      const r = await mealie('GET', '/recipes', {
        query: {
          search: query,
          tags,
          categories,
          foods,
          page: page ?? 1,
          perPage: perPage ?? 20,
          orderBy: query ? undefined : 'name',
          orderDirection: query ? undefined : 'asc',
        },
      })
      return json({
        page: r.page,
        totalPages: r.totalPages ?? r.total_pages,
        total: r.total,
        recipes: (r.items ?? []).map(recipeSummary),
      })
    },
  )

  server.registerTool(
    'get_recipe',
    {
      title: 'Get recipe',
      description:
        'Get one recipe with its ingredients, instructions, notes, categories, tags, prep/cook/total times (Mealie text, e.g. "1 hour 30 minutes"), nutrition per serving (the same object and units create_recipe and update_recipe take) and when it was last made. Each ingredient comes with the food it is saved as linked to (id and name) and the store section of that food, plus the subheading (section) it starts, if any; an ingredient without a food is not linked. Fields that are not set are left out, so use this to confirm what was saved.',
      inputSchema: {
        slug: z.string().describe('Recipe slug (or id) from search_recipes'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => {
      const r = await mealie('GET', `/recipes/${encodeURIComponent(slug)}`)
      return json({
        ...(await recipeWithLinks(r)),
        lastMade: await lastMade(r.slug),
      })
    },
  )

  server.registerTool(
    'import_recipe_from_url',
    {
      title: 'Import recipe from a web page',
      description:
        "Have Mealie scrape a recipe web page and save it. Returns the new recipe's slug. If Mealie's AI provider is set up, it is used for pages the normal scraper can't read.",
      inputSchema: {
        url: z.url().describe('The recipe page URL'),
        includeTags: z
          .boolean()
          .optional()
          .describe("Also import the page's tags/keywords"),
        parseIngredients: parseArg,
      },
    },
    async ({ url, includeTags, parseIngredients }) => {
      const slug = await mealie<string>('POST', '/recipes/create/url', {
        body: { url, includeTags: includeTags ?? false },
      })
      const { recipe, parsing } = await parseAfterSave(slug, parseIngredients)
      return json({ slug, parsing, recipe: recipeDetail(recipe) })
    },
  )

  server.registerTool(
    'create_recipe',
    {
      title: 'Create recipe',
      description:
        'Save a new recipe you have written or transcribed. Mealie parses it like a schema.org Recipe. Returns the new slug. Give it a category and tags so it is filed in the cookbook. ' +
        ORGANIZING_SCHEME +
        ' ' +
        MEAL_GUIDANCE,
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        ingredients: z
          .array(ingredientEntry)
          .describe(
            'One ingredient per entry, e.g. "2 cups flour". Put each food on its own entry: "salt, to taste" and "pepper, to taste", not "salt and pepper" (combined lines are split automatically when possible). ' +
              SECTION_HELP,
          ),
        instructions: z.array(z.string()).describe('One step per entry'),
        servings: z.string().optional().describe('e.g. "4 servings"'),
        prepTime: durationArg('Hands-on prep time'),
        cookTime: durationArg('Cooking time'),
        totalTime: durationArg('Total time'),
        categories: categoriesArg,
        tags: tagsArg,
        nutrition: nutritionArg,
        notes: z
          .array(z.object({ title: z.string().optional(), text: z.string() }))
          .optional()
          .describe('Recipe notes, e.g. that the nutrition is an estimate'),
        allowDuplicateName: z
          .boolean()
          .optional()
          .describe(
            'Save even if a recipe with exactly this name exists (default false: the call fails and names the existing recipe, so a retry never makes a "(1)" copy)',
          ),
        sourceUrl: z.url().optional(),
        parseIngredients: parseArg,
      },
    },
    async (a) => {
      if (!a.allowDuplicateName) {
        const found = await mealie('GET', '/recipes', {
          query: { search: a.name, perPage: 20 },
        })
        const same = (found.items ?? []).find(
          (r: any) => r.name?.trim().toLowerCase() === a.name.trim().toLowerCase(),
        )
        if (same) {
          throw new Error(
            `A recipe named "${same.name}" already exists (slug ${same.slug}). If an earlier create_recipe call saved it, finish it with update_recipe instead of creating it again; to save a second recipe with this name, pass allowDuplicateName: true.`,
          )
        }
      }
      const { lines, titles } = flattenIngredients(a.ingredients)
      const schemaOrg = {
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: a.name,
        description: a.description,
        recipeIngredient: lines,
        recipeInstructions: a.instructions.map((text) => ({
          '@type': 'HowToStep',
          text,
        })),
        recipeYield: a.servings,
        prepTime: a.prepTime,
        cookTime: a.cookTime,
        totalTime: a.totalTime,
      }
      const slug = await mealie<string>(
        'POST',
        '/recipes/create/html-or-json',
        {
          body: {
            data: JSON.stringify(schemaOrg),
            url: a.sourceUrl,
            includeTags: false,
          },
        },
      )
      // The recipe is saved now. Later steps report problems instead of
      // failing the call, so a retry doesn't save a second copy.
      const warnings: string[] = []
      const step = async <T>(what: string, f: () => Promise<T>) => {
        try {
          return await f()
        } catch (err) {
          warnings.push(`${what}: ${(err as Error).message ?? err}`)
          return undefined
        }
      }
      // Mealie's JSON import doesn't keep the times, so set them directly.
      await step('Saving times, nutrition, notes and ingredient subheadings', async () => {
        const extra: Record<string, unknown> = timePatch(a)
        if (a.nutrition) {
          const current = await mealie<any>(
            'GET',
            `/recipes/${encodeURIComponent(slug)}`,
          )
          Object.assign(extra, nutritionPatch(current, a.nutrition))
        }
        if (titles.some(Boolean)) {
          // The JSON import has no subheadings; put them on the saved lines.
          const current = await mealie<any>(
            'GET',
            `/recipes/${encodeURIComponent(slug)}`,
          )
          const saved: any[] = current.recipeIngredient ?? []
          if (saved.length !== lines.length) {
            throw new Error(
              `Mealie saved ${saved.length} ingredients for ${lines.length} lines, so the subheadings were not set; set them with update_recipe`,
            )
          }
          extra.recipeIngredient = saved.map((ing, i) => ({
            ...ing,
            title: titles[i] ?? '',
          }))
        }
        if (a.notes?.length) {
          extra.notes = a.notes.map((n) => ({
            title: n.title ?? '',
            text: n.text,
          }))
        }
        if (Object.keys(extra).length) {
          await mealie('PATCH', `/recipes/${encodeURIComponent(slug)}`, {
            body: extra,
          })
        }
      })
      const createdOrganizers = await step('Setting categories and tags', () =>
        setOrganizers(slug, a.categories, a.tags),
      )
      const { recipe, parsing } = await parseAfterSave(slug, a.parseIngredients)
      return json({
        slug,
        warnings: warnings.length
          ? [
              ...warnings,
              'The recipe is saved; fix these with update_recipe rather than creating it again.',
            ]
          : undefined,
        createdOrganizers,
        parsing,
        recipe: await recipeWithLinks(recipe),
      })
    },
  )

  server.registerTool(
    'update_recipe',
    {
      title: 'Update recipe',
      description:
        "Change fields of an existing recipe. Only the fields you pass are changed. Ingredients, instructions, notes, categories and tags, if given, replace the existing lists, so to add a tag pass the recipe's current tags plus the new one. To split a combined recipe into a main and a side, create the side with create_recipe, update this one to remove the side's ingredients and steps, and fix the meal plan. " +
        ORGANIZING_SCHEME +
        ' ' +
        MEAL_GUIDANCE,
      inputSchema: {
        slug: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        servings: z
          .string()
          .optional()
          .describe('Text yield, e.g. "4 servings"'),
        prepTime: durationArg('Hands-on prep time'),
        cookTime: durationArg('Cooking time'),
        totalTime: durationArg('Total time'),
        ingredients: z
          .array(ingredientEntry)
          .optional()
          .describe(
            'Replaces all ingredients; one per entry, and one food per entry ("salt, to taste" and "pepper, to taste", not "salt and pepper"). ' +
              SECTION_HELP +
              ' To add subheadings to a recipe, pass all its ingredients again grouped into sections.',
          ),
        instructions: z
          .array(z.string())
          .optional()
          .describe('Replaces all steps; one per entry'),
        notes: z
          .array(z.object({ title: z.string().optional(), text: z.string() }))
          .optional()
          .describe('Replaces all notes'),
        categories: categoriesArg,
        tags: tagsArg,
        nutrition: nutritionArg,
        parseIngredients: parseArg,
      },
    },
    async ({
      slug,
      name,
      description,
      servings,
      prepTime,
      cookTime,
      totalTime,
      ingredients,
      instructions,
      notes,
      categories,
      tags,
      nutrition,
      parseIngredients,
    }) => {
      const patch: Record<string, unknown> = {}
      if (name !== undefined) patch.name = name
      if (description !== undefined) patch.description = description
      if (servings !== undefined) patch.recipeYield = servings
      Object.assign(patch, timePatch({ prepTime, cookTime, totalTime }))
      if (nutrition) {
        const current = await mealie<any>(
          'GET',
          `/recipes/${encodeURIComponent(slug)}`,
        )
        Object.assign(patch, nutritionPatch(current, nutrition))
      }
      if (ingredients) {
        const { lines, titles } = flattenIngredients(ingredients)
        patch.recipeIngredient = lines.map((note, i) => ({
          note,
          originalText: note,
          display: note,
          title: titles[i] ?? '',
        }))
      }
      if (instructions)
        patch.recipeInstructions = instructions.map((text) => ({ text }))
      if (notes)
        patch.notes = notes.map((n) => ({ title: n.title ?? '', text: n.text }))
      let current = slug
      if (Object.keys(patch).length) {
        const r = await mealie(
          'PATCH',
          `/recipes/${encodeURIComponent(slug)}`,
          { body: patch },
        )
        current = r.slug
      }
      const createdOrganizers = await setOrganizers(current, categories, tags)
      if (!ingredients) {
        const r = await mealie('GET', `/recipes/${encodeURIComponent(current)}`)
        return json({ createdOrganizers, recipe: await recipeWithLinks(r) })
      }
      const { recipe, parsing } = await parseAfterSave(
        current,
        parseIngredients,
      )
      return json({
        createdOrganizers,
        parsing,
        recipe: await recipeWithLinks(recipe),
      })
    },
  )

  server.registerTool(
    'set_recipe_image',
    {
      title: 'Set recipe images',
      description:
        "Set or replace recipe photos. For one recipe give slug and imageUrl (a direct link to a JPEG, PNG or WebP image, or a page Mealie can find the image on; Mealie downloads it) or imageBase64 with its format. For several recipes give images, a list of {slug, imageUrl}, in one call. Mealie can be slow to download photos: anything not finished within about 40 seconds is reported as still_saving and keeps saving in the background, so check those later with get_recipe's hasImage instead of retrying.",
      inputSchema: {
        slug: z.string().optional().describe('Recipe slug from search_recipes'),
        imageUrl: z.url().optional().describe('Public URL of the image'),
        imageBase64: z
          .string()
          .optional()
          .describe('The image file itself, base64-encoded (no data: prefix needed)'),
        format: z
          .enum(['jpg', 'jpeg', 'png', 'webp'])
          .optional()
          .describe('Format of imageBase64 (default jpg)'),
        images: z
          .array(z.object({ slug: z.string(), imageUrl: z.url() }))
          .max(50)
          .optional()
          .describe('Several recipes at once, instead of slug and imageUrl'),
      },
    },
    async ({ slug, imageUrl, imageBase64, format, images }) => {
      type Job = { slug: string; imageUrl?: string; imageBase64?: string }
      let jobs: Job[]
      if (images?.length) {
        if (slug || imageUrl || imageBase64) {
          throw new Error('Give either images or slug with one image, not both.')
        }
        jobs = images
      } else {
        if (!slug) throw new Error('Give slug, or images for several recipes.')
        if (!imageUrl === !imageBase64) {
          throw new Error('Give exactly one of imageUrl or imageBase64.')
        }
        jobs = [{ slug, imageUrl, imageBase64 }]
      }
      const save = async (j: Job) => {
        const path = `/recipes/${encodeURIComponent(j.slug)}/image`
        if (j.imageUrl) {
          await mealie('POST', path, {
            body: { url: j.imageUrl },
            timeoutMs: 300_000,
          })
        } else {
          const data = j.imageBase64!.replace(/^data:[^;]+;base64,/, '')
          const bytes = Buffer.from(data, 'base64')
          if (!bytes.length) throw new Error('imageBase64 is empty or not base64.')
          const ext = format ?? 'jpg'
          const form = new FormData()
          form.append(
            'image',
            new Blob([bytes], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }),
            `image.${ext}`,
          )
          form.append('extension', ext)
          await mealie('PUT', path, { form, timeoutMs: 300_000 })
        }
      }
      // A few at a time, so a big batch doesn't swamp Mealie.
      const status = new Map<string, { status: string; error?: string }>()
      const queue = [...jobs]
      const worker = async () => {
        for (let j = queue.shift(); j; j = queue.shift()) {
          status.set(j.slug, { status: 'saving' })
          try {
            await save(j)
            status.set(j.slug, { status: 'saved' })
          } catch (err) {
            status.set(j.slug, {
              status: 'failed',
              error: String((err as Error).message ?? err),
            })
          }
        }
      }
      const all = Promise.all(
        Array.from({ length: Math.min(3, jobs.length) }, worker),
      )
      await Promise.race([all, new Promise((r) => setTimeout(r, 40_000))])
      return json({
        results: jobs.map((j) => {
          const s = status.get(j.slug)
          return {
            slug: j.slug,
            status:
              !s || s.status === 'saving' ? 'still_saving' : s.status,
            error: s?.error,
          }
        }),
        note: jobs.some((j) => (status.get(j.slug)?.status ?? 'saving') === 'saving')
          ? 'Images marked still_saving keep saving in the background; check them with get_recipe (hasImage) in a minute instead of sending them again.'
          : undefined,
      })
    },
  )

  server.registerTool(
    'merge_foods',
    {
      title: 'Merge duplicate foods',
      description:
        'Merge duplicate foods (for example "onion" and "onions") into one. Every recipe ingredient and shopping list item linked to a duplicate is moved to the food you keep, then the duplicates are deleted. If the kept food has no store section, it takes the first one a duplicate had. Find duplicates with list_foods. This cannot be undone.',
      inputSchema: {
        keepFoodId: z.string().describe('Id of the food to keep, from list_foods'),
        duplicateFoodIds: z
          .array(z.string())
          .min(1)
          .describe('Ids of the duplicate foods to merge into it and delete'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ keepFoodId, duplicateFoodIds }) => {
      const keep = await mealie('GET', `/foods/${encodeURIComponent(keepFoodId)}`)
      const labels = await listLabels()
      let inheritLabel: string | undefined
      const merged = []
      for (const id of new Set(duplicateFoodIds)) {
        if (id === keep.id) continue
        try {
          const dup = await mealie('GET', `/foods/${encodeURIComponent(id)}`)
          const usage = await foodUsage(dup.id)
          await mealie('PUT', '/foods/merge', {
            body: { fromFood: dup.id, toFood: keep.id },
          })
          if (!inheritLabel && dup.labelId) inheritLabel = dup.labelId
          merged.push({
            id: dup.id,
            name: dup.name,
            result: 'merged',
            relinkedRecipes: usage.recipeCount,
            recipes: usage.recipes.length ? usage.recipes : undefined,
            relinkedShoppingItems: usage.shoppingItemCount,
          })
        } catch (err) {
          merged.push({
            id,
            result: 'failed',
            error: String((err as Error).message ?? err),
          })
        }
      }
      let food = await mealie('GET', `/foods/${encodeURIComponent(keep.id)}`)
      if (!food.labelId && inheritLabel) {
        food = await mealie('PUT', `/foods/${encodeURIComponent(keep.id)}`, {
          body: { ...food, labelId: inheritLabel },
        })
      }
      return json({
        kept: {
          id: food.id,
          name: food.name,
          storeSection: sectionName(food, labels),
        },
        duplicates: merged,
        ingredientTextRewritten: false,
        note: "Merging only relinks: each ingredient's original text is kept as written, and its food is now the kept one.",
      })
    },
  )

  server.registerTool(
    'delete_food',
    {
      title: 'Delete food',
      description:
        'Delete a food (for example a junk name the parser made) that nothing uses any more. It refuses, and lists what still uses it, if any recipe ingredient or shopping list item is linked to it; relink those first, or use merge_foods to fold it into the right food. This cannot be undone.',
      inputSchema: {
        foodId: z.string().describe('Id of the food, from list_foods'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ foodId }) => {
      const food = await mealie('GET', `/foods/${encodeURIComponent(foodId)}`)
      const usage = await foodUsage(food.id)
      if (usage.recipeCount || usage.shoppingItemCount) {
        throw new Error(
          `"${food.name}" is still used by ${usage.recipeCount} recipe(s)${usage.recipes.length ? ` (${usage.recipes.join(', ')})` : ''} and ${usage.shoppingItemCount} shopping list item(s), so it was not deleted. Relink them, or use merge_foods to fold it into the right food.`,
        )
      }
      await mealie('DELETE', `/foods/${encodeURIComponent(food.id)}`)
      return json({ deleted: { id: food.id, name: food.name } })
    },
  )

  server.registerTool(
    'delete_recipe',
    {
      title: 'Delete recipe',
      description:
        'Permanently delete a recipe, for example the old combined recipe after splitting it into a main and sides. Check the meal plan first: entries that pointed at it lose their recipe. This cannot be undone.',
      inputSchema: {
        slug: z.string().describe('Recipe slug from search_recipes'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ slug }) => {
      const r = await mealie('DELETE', `/recipes/${encodeURIComponent(slug)}`)
      return json({ deleted: r?.slug ?? slug, name: r?.name })
    },
  )

  server.registerTool(
    'parse_recipe_ingredients',
    {
      title: "Parse a recipe's ingredients",
      description:
        "Run Mealie's ingredient parser on a saved recipe: split each ingredient into quantity, unit and food, link it to Mealie's foods and units (creating missing ones), and save. Use it on recipes whose ingredients are plain text, so they shop and sort properly.",
      inputSchema: {
        slug: z.string(),
        parser: parserArg,
        reparseAll: z
          .boolean()
          .optional()
          .describe(
            'Also re-parse ingredients already linked to a food (default false)',
          ),
      },
    },
    async ({ slug, parser, reparseAll }) => {
      const r = await parseRecipe(slug, { parser, onlyUnlinked: !reparseAll })
      return json({
        parser: r.parser,
        parsed: r.parsed,
        splitLines: r.splitLines,
        createdFoods: r.createdFoods,
        createdUnits: r.createdUnits,
        lowConfidence: r.lowConfidence,
        ingredients: (r.recipe.recipeIngredient ?? []).map((i: any) => ({
          text: i.display || i.originalText || i.note,
          quantity: i.quantity,
          unit: i.unit?.name,
          food: i.food?.name,
          storeSection: i.food?.label?.name,
          note: i.note || undefined,
        })),
      })
    },
  )

  server.registerTool(
    'parse_ingredients',
    {
      title: 'Parse ingredient lines',
      description:
        'Preview how Mealie parses ingredient lines into quantity, unit and food. Saves nothing.',
      inputSchema: {
        lines: z.array(z.string()).min(1),
        parser: parserArg,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ lines, parser }) => {
      const pieces = splitLines(lines)
      const r = await parseLines(
        pieces.map((p) => p.text),
        parser,
      )
      return json({
        parser: r.parser,
        lines: r.lines.map((l, k) => {
          const own = l.food?.id ? ownFoodText(l, l.food) : undefined
          return {
          input: lines[pieces[k].from],
          splitAs:
            pieces[k].text !== lines[pieces[k].from]
              ? pieces[k].text
              : undefined,
          quantity: l.quantity,
          unit: l.unit?.name,
          food: own ?? l.food?.name,
          foodExists: own ? undefined : Boolean(l.food?.id),
          parserMatchedInstead: own ? l.food?.name : undefined,
          note: l.note || undefined,
          confidence: l.confidence,
        }
        }),
      })
    },
  )

  server.registerTool(
    'list_organizers',
    {
      title: 'List recipe categories and tags',
      description:
        'List the recipe categories and tags that exist, with how many recipes use each. Check this before tagging so you reuse existing names. ' +
        ORGANIZING_SCHEME,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const shape = (o: any) => ({
        name: o.name,
        slug: o.slug,
        recipes: o.recipeCount ?? undefined,
      })
      const [categories, tags] = await Promise.all([
        listOrganizers('categories'),
        listOrganizers('tags'),
      ])
      return json({
        categories: categories.map(shape),
        tags: tags.map(shape),
      })
    },
  )

  server.registerTool(
    'mark_cooked',
    {
      title: 'Mark recipe as cooked',
      description:
        'Record that a recipe was made, like Mealie\'s "I made this" button: adds an entry to the recipe\'s timeline and updates its last-made date.',
      inputSchema: {
        slug: z.string().describe('Recipe slug (or id)'),
        date: date
          .optional()
          .describe('Day it was made, YYYY-MM-DD (default today)'),
        note: z
          .string()
          .optional()
          .describe('Optional comment, e.g. "Doubled the garlic"'),
      },
    },
    async ({ slug, date, note }) => {
      const recipe = await mealie('GET', `/recipes/${encodeURIComponent(slug)}`)
      // Noon UTC keeps the chosen day the same in every time zone.
      const timestamp = date ? `${date}T12:00:00Z` : new Date().toISOString()
      await mealie('POST', '/recipes/timeline/events', {
        body: {
          recipeId: recipe.id,
          subject: 'Made this',
          eventType: 'comment',
          eventMessage: note ?? '',
          timestamp,
        },
      })
      const previous = await lastMade(recipe.slug)
      if (!previous || new Date(previous) < new Date(timestamp)) {
        await mealie(
          'PATCH',
          `/recipes/${encodeURIComponent(recipe.slug)}/last-made`,
          { body: { timestamp } },
        )
      }
      return json({
        slug: recipe.slug,
        name: recipe.name,
        madeOn: timestamp,
        lastMade: (await lastMade(recipe.slug)) ?? timestamp,
      })
    },
  )

  server.registerTool(
    'list_cook_notes',
    {
      title: 'List cooking notes',
      description:
        'List notes taken while cooking, newest day first, grouped by recipe: the "Cook notes" the YesChef app saves from cook mode (one line per note with the time and the step it was taken at, e.g. "- 6:42 PM, step 3 (Sear the steak): needed 2 more minutes a side"), and comments left with Mealie\'s "I made this" or mark_cooked. ' +
        'Use it when the user asks to review their cooking: read each recipe with get_recipe, say what went wrong or was hard and why, and suggest concrete fixes for next time (times, temperatures, amounts, step order, clearer wording). ' +
        'Only save changes the user agrees to, with update_recipe; tips that are not a change to a step can go in the recipe notes. The cooking notes stay as a record either way.',
      inputSchema: {
        since: date
          .optional()
          .describe('First day, YYYY-MM-DD (default 7 days ago)'),
        until: date.optional().describe('Last day, YYYY-MM-DD (default today)'),
        slug: z
          .string()
          .optional()
          .describe('Only this recipe (slug or id)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ since, until, slug }) => {
      const today = localDay(new Date())
      const first = since ?? localDay(new Date(Date.now() - 6 * 86_400_000))
      const last = until ?? today
      // Day boundaries in the box's time zone (TZ is set for the connector).
      const start = new Date(`${first}T00:00:00`)
      const end = new Date(`${last}T00:00:00`)
      end.setDate(end.getDate() + 1)
      const only = slug
        ? (await mealie('GET', `/recipes/${encodeURIComponent(slug)}`)).id
        : undefined

      const found: any[] = []
      // Newest first; stop at the first event before the range.
      pages: for (let page = 1; page <= 20; page++) {
        const r = await mealie('GET', '/recipes/timeline/events', {
          query: {
            page,
            perPage: 100,
            orderBy: 'timestamp',
            orderDirection: 'desc',
          },
        })
        for (const e of r.items ?? []) {
          const at = eventTime(e.timestamp)
          if (at < start) break pages
          if (at >= end || e.eventType !== 'comment') continue
          if (!String(e.eventMessage ?? '').trim()) continue
          if (only && e.recipeId !== only) continue
          found.push({ ...e, at })
        }
        if (page >= (r.totalPages ?? r.total_pages ?? 1)) break
      }

      const recipes = new Map<string, any>()
      for (const id of new Set(found.map((e) => e.recipeId))) {
        try {
          const r = await mealie('GET', `/recipes/${encodeURIComponent(id)}`)
          recipes.set(id, { slug: r.slug, name: r.name })
        } catch {
          recipes.set(id, { id, name: '(recipe deleted)' })
        }
      }
      const groups = new Map<string, any>()
      for (const e of found) {
        const day = localDay(e.at)
        const key = `${day} ${e.recipeId}`
        if (!groups.has(key))
          groups.set(key, { day, recipe: recipes.get(e.recipeId), notes: [] })
        groups.get(key).notes.push({
          at: e.at.toISOString(),
          subject: e.subject,
          text: String(e.eventMessage).trim(),
        })
      }
      return json({
        since: first,
        until: last,
        cooked: [...groups.values()].map((g) => ({
          ...g,
          notes: g.notes.reverse(),
        })),
      })
    },
  )

  // ---------------- Store sections ----------------
  server.registerTool(
    'list_store_sections',
    {
      title: 'List store sections',
      description:
        "List the store sections (Mealie 'labels', e.g. Produce, Dairy) that shopping lists are grouped by.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      json((await listLabels()).map((l: any) => ({ id: l.id, name: l.name }))),
  )

  server.registerTool(
    'set_food_store_section',
    {
      title: "Set a food's store section",
      description:
        'Set which store section (aisle) a food belongs to, e.g. "chicken thighs" -> "Meat". The section is created if it does not exist, and so is the food. Every future shopping list item linked to this food is sorted into that section. For each food it reports whether it matched an existing food or created a new one (check created ones for accidental duplicates with list_foods) and its previous section.',
      inputSchema: {
        foods: z
          .array(z.string())
          .min(1)
          .describe('Food names (or ids) to put in this section'),
        section: z.string().describe('Store section name, e.g. "Produce"'),
      },
    },
    async ({ foods, section }) => {
      const { label, created } = await findOrCreateLabel(section)
      const labels = await listLabels()
      const results = []
      for (const f of foods) {
        const { food, created: foodCreated } = await findOrCreateFood(f)
        const previousSection = sectionName(food, labels)
        await mealie('PUT', `/foods/${food.id}`, {
          body: { ...food, labelId: label.id },
        })
        results.push({
          requested: f,
          id: food.id,
          name: food.name,
          result: foodCreated ? 'created' : 'matched',
          previousSection,
        })
      }
      return json({
        section: label.name,
        sectionCreated: created,
        foods: results,
      })
    },
  )

  server.registerTool(
    'list_foods',
    {
      title: 'List foods',
      description:
        "List Mealie's foods (the things ingredients and shopping items link to) with each one's id and store section. Use search to find a food or near-duplicates (e.g. \"onion\" and \"onions\"); without search it pages through every food.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Text to match in food names'),
        page: z.number().int().min(1).optional().describe('Page, from 1'),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Foods per page (default 100)'),
        includeUsage: z
          .boolean()
          .optional()
          .describe(
            'Also count the recipes and shopping list items linked to each food (slower; use with search or a small perPage)',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, page, perPage, includeUsage }) => {
      const [r, labels] = await Promise.all([
        mealie('GET', '/foods', {
          query: {
            search,
            page: page ?? 1,
            perPage: perPage ?? 100,
            orderBy: 'name',
            orderDirection: 'asc',
          },
        }),
        listLabels(),
      ])
      return json({
        page: r.page ?? page ?? 1,
        totalPages: r.total_pages ?? undefined,
        total: r.total ?? undefined,
        foods: await (async () => {
          const items = includeUsage ? await shoppingItems() : undefined
          const out = []
          for (const f of r.items ?? []) {
            const usage = includeUsage ? await foodUsage(f.id, items) : undefined
            out.push({
              id: f.id,
              name: f.name,
              pluralName: f.pluralName || undefined,
              storeSection: sectionName(f, labels),
              recipeCount: usage?.recipeCount,
              shoppingItemCount: usage?.shoppingItemCount,
            })
          }
          return out
        })(),
      })
    },
  )

  // ---------------- Meal plans ----------------
  server.registerTool(
    'list_meal_plan',
    {
      title: 'List meal plan',
      description: 'List planned meals between two dates (inclusive).',
      inputSchema: { startDate: date, endDate: date },
      annotations: { readOnlyHint: true },
    },
    async ({ startDate, endDate }) => {
      const r = await mealie('GET', '/households/mealplans', {
        query: {
          start_date: startDate,
          end_date: endDate,
          perPage: -1,
          orderBy: 'date',
          orderDirection: 'asc',
        },
      })
      return json(
        (r.items ?? []).map((e: any) => ({
          id: e.id,
          date: e.date,
          entryType: e.entryType,
          title: e.title || undefined,
          text: e.text || undefined,
          recipe: e.recipe
            ? { id: e.recipe.id, slug: e.recipe.slug, name: e.recipe.name }
            : undefined,
        })),
      )
    },
  )

  server.registerTool(
    'add_meal_plan_entry',
    {
      title: 'Add to meal plan',
      description:
        'Plan a recipe on a date. Give recipeId (from search_recipes) for a saved recipe, or a title for a free-text entry like "Leftovers". Add one entry per dish: a main and its sides each get their own entry with the same date and entryType. ' +
        MEAL_GUIDANCE,
      inputSchema: {
        date,
        entryType,
        recipeId: z.string().optional(),
        title: z.string().optional(),
        text: z.string().optional().describe('Optional note'),
      },
    },
    async ({ date, entryType, recipeId, title, text }) => {
      if (!recipeId && !title) throw new Error('Give either recipeId or title')
      const e = await mealie('POST', '/households/mealplans', {
        body: {
          date,
          entryType,
          recipeId: recipeId ?? null,
          title: title ?? '',
          text: text ?? '',
        },
      })
      return json({
        id: e.id,
        date: e.date,
        entryType: e.entryType,
        recipe: e.recipe?.name,
        title: e.title,
      })
    },
  )

  server.registerTool(
    'remove_meal_plan_entry',
    {
      title: 'Remove from meal plan',
      description: 'Delete one meal plan entry by id (from list_meal_plan).',
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      await mealie('DELETE', `/households/mealplans/${encodeURIComponent(id)}`)
      return json({ removed: id })
    },
  )

  // ---------------- Shopping lists ----------------
  server.registerTool(
    'list_shopping_lists',
    {
      title: 'List shopping lists',
      description: 'List shopping lists (id and name).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const r = await mealie('GET', '/households/shopping/lists', {
        query: { perPage: -1 },
      })
      return json((r.items ?? []).map((l: any) => ({ id: l.id, name: l.name })))
    },
  )

  server.registerTool(
    'get_shopping_list',
    {
      title: 'Get shopping list',
      description:
        'Get the items on one shopping list, sorted by store section. Items without a section come last.',
      inputSchema: {
        listId: z.string(),
        includeChecked: z
          .boolean()
          .optional()
          .describe('Include checked-off items (default false)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ listId, includeChecked }) => {
      const l = await mealie(
        'GET',
        `/households/shopping/lists/${encodeURIComponent(listId)}`,
      )
      const items = (l.listItems ?? [])
        .filter((i: any) => includeChecked || !i.checked)
        .map(itemSummary)
        .sort(
          (a: any, b: any) =>
            (a.storeSection ?? '\uffff').localeCompare(
              b.storeSection ?? '\uffff',
            ) || a.item.localeCompare(b.item),
        )
      return json({ id: l.id, name: l.name, items })
    },
  )

  server.registerTool(
    'create_shopping_list',
    {
      title: 'Create shopping list',
      description: 'Create a new, empty shopping list.',
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const l = await mealie('POST', '/households/shopping/lists', {
        body: { name },
      })
      return json({ id: l.id, name: l.name })
    },
  )

  server.registerTool(
    'add_shopping_list_items',
    {
      title: 'Add items to shopping list',
      description: 'Add free-text items to a shopping list.',
      inputSchema: {
        listId: z.string(),
        items: z
          .array(
            z.object({
              item: z.string().describe('e.g. "2 lb chicken thighs"'),
              quantity: z.number().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ listId, items }) => {
      const r = await mealie('POST', '/households/shopping/items/create-bulk', {
        body: items.map((i) => ({
          shoppingListId: listId,
          note: i.item,
          quantity: i.quantity ?? 1,
        })),
      })
      return json({
        created: (r.createdItems ?? []).map(itemSummary),
        updated: (r.updatedItems ?? []).map(itemSummary),
      })
    },
  )

  server.registerTool(
    'add_recipe_to_shopping_list',
    {
      title: "Add a recipe's ingredients to shopping list",
      description:
        'Add all ingredients of a recipe to a shopping list. Mealie merges duplicates with items already on the list.',
      inputSchema: {
        listId: z.string(),
        recipeId: z
          .string()
          .describe('Recipe id (not slug) from search_recipes'),
        scale: z
          .number()
          .positive()
          .optional()
          .describe('Multiply quantities, e.g. 2 for a double batch'),
      },
    },
    async ({ listId, recipeId, scale }) => {
      const l = await mealie(
        'POST',
        `/households/shopping/lists/${encodeURIComponent(listId)}/recipe`,
        {
          body: [{ recipeId, recipeIncrementQuantity: scale ?? 1 }],
        },
      )
      return json({
        id: l.id,
        name: l.name,
        items: (l.listItems ?? [])
          .filter((i: any) => !i.checked)
          .map(itemSummary),
      })
    },
  )

  server.registerTool(
    'add_meal_plan_to_shopping_list',
    {
      title: 'Add a meal plan to shopping list',
      description:
        'Add the ingredients of every recipe planned between two dates (inclusive) to a shopping list, in one call. Mealie merges duplicates. Free-text meal plan entries without a recipe are skipped and listed. To rebuild a list for the week, run clear_shopping_list first.',
      inputSchema: {
        listId: z.string(),
        startDate: date,
        endDate: date,
      },
    },
    async ({ listId, startDate, endDate }) => {
      const plan = await mealie('GET', '/households/mealplans', {
        query: {
          start_date: startDate,
          end_date: endDate,
          perPage: -1,
          orderBy: 'date',
          orderDirection: 'asc',
        },
      })
      const entries = plan.items ?? []
      const withRecipe = entries.filter((e: any) => e.recipe?.id || e.recipeId)
      const skipped = entries
        .filter((e: any) => !(e.recipe?.id || e.recipeId))
        .map(
          (e: any) =>
            `${e.date} ${e.entryType}: ${e.title || e.text || '(no title)'}`,
        )
      if (!withRecipe.length) {
        return json({
          addedRecipes: [],
          skipped,
          note: 'No planned recipes in that range.',
        })
      }
      const l = await mealie(
        'POST',
        `/households/shopping/lists/${encodeURIComponent(listId)}/recipe`,
        {
          body: withRecipe.map((e: any) => ({
            recipeId: e.recipe?.id ?? e.recipeId,
            recipeIncrementQuantity: 1,
          })),
        },
      )
      return json({
        list: { id: l.id, name: l.name },
        addedRecipes: withRecipe.map(
          (e: any) =>
            `${e.date} ${e.entryType}: ${e.recipe?.name ?? e.recipeId}`,
        ),
        skipped,
        items: (l.listItems ?? [])
          .filter((i: any) => !i.checked)
          .map(itemSummary),
      })
    },
  )

  server.registerTool(
    'clear_shopping_list',
    {
      title: 'Clear shopping list',
      description:
        'Remove items from one shopping list in a single call: every item, or only the checked-off ones. The list itself and other lists are untouched.',
      inputSchema: {
        listId: z.string(),
        onlyChecked: z
          .boolean()
          .optional()
          .describe(
            'Only remove checked-off items (default false: remove everything)',
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ listId, onlyChecked }) => {
      const l = await mealie(
        'GET',
        `/households/shopping/lists/${encodeURIComponent(listId)}`,
      )
      const ids = (l.listItems ?? [])
        .filter((i: any) => !onlyChecked || i.checked)
        .map((i: any) => i.id)
      for (let k = 0; k < ids.length; k += 50) {
        await mealie('DELETE', '/households/shopping/items', {
          query: { ids: ids.slice(k, k + 50) },
        })
      }
      return json({ list: { id: l.id, name: l.name }, removed: ids.length })
    },
  )

  server.registerTool(
    'set_shopping_item_checked',
    {
      title: 'Check off shopping item',
      description: 'Mark a shopping list item as bought (checked) or not.',
      inputSchema: { itemId: z.string(), checked: z.boolean() },
    },
    async ({ itemId, checked }) => {
      const item = await mealie(
        'GET',
        `/households/shopping/items/${encodeURIComponent(itemId)}`,
      )
      await mealie(
        'PUT',
        `/households/shopping/items/${encodeURIComponent(itemId)}`,
        {
          body: { ...item, checked },
        },
      )
      return json({ id: itemId, checked })
    },
  )

  server.registerTool(
    'set_shopping_item_store_section',
    {
      title: "Set a shopping item's store section",
      description:
        'Move one shopping list item into a store section. To make it stick for future lists, also use set_food_store_section on its food.',
      inputSchema: {
        itemId: z.string(),
        section: z.string().describe('Store section name, e.g. "Bakery"'),
      },
    },
    async ({ itemId, section }) => {
      const { label } = await findOrCreateLabel(section)
      const item = await mealie(
        'GET',
        `/households/shopping/items/${encodeURIComponent(itemId)}`,
      )
      await mealie(
        'PUT',
        `/households/shopping/items/${encodeURIComponent(itemId)}`,
        {
          body: { ...item, labelId: label.id },
        },
      )
      return json({ id: itemId, section: label.name, food: item.food?.name })
    },
  )

  server.registerTool(
    'remove_shopping_item',
    {
      title: 'Remove shopping item',
      description: 'Delete an item from its shopping list.',
      inputSchema: { itemId: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ itemId }) => {
      await mealie(
        'DELETE',
        `/households/shopping/items/${encodeURIComponent(itemId)}`,
      )
      return json({ removed: itemId })
    },
  )
}
