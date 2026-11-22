import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { mealie } from './mealie.js'
import {
  findOrCreateFood,
  findOrCreateLabel,
  listLabels,
  parseLines,
  parseRecipe,
} from './ingredients.js'

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
        createdFoods: r.createdFoods,
        createdUnits: r.createdUnits,
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

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Date as YYYY-MM-DD')

const entryType = z
  .enum(['breakfast', 'lunch', 'dinner', 'side', 'snack', 'drink', 'dessert'])
  .describe('Which meal of the day')

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
    performTime: r.performTime || undefined,
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
    async ({ query, tags, categories, page, perPage }) => {
      const r = await mealie('GET', '/recipes', {
        query: {
          search: query,
          tags,
          categories,
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
        'Get one recipe with its ingredients, instructions and notes.',
      inputSchema: {
        slug: z.string().describe('Recipe slug (or id) from search_recipes'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) =>
      json(
        recipeDetail(
          await mealie('GET', `/recipes/${encodeURIComponent(slug)}`),
        ),
      ),
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
        'Save a new recipe you have written or transcribed. Mealie parses it like a schema.org Recipe. Returns the new slug.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        ingredients: z
          .array(z.string())
          .describe('One ingredient per entry, e.g. "2 cups flour"'),
        instructions: z.array(z.string()).describe('One step per entry'),
        servings: z.string().optional().describe('e.g. "4 servings"'),
        prepTime: z
          .string()
          .optional()
          .describe('ISO 8601 duration, e.g. PT15M'),
        cookTime: z
          .string()
          .optional()
          .describe('ISO 8601 duration, e.g. PT1H'),
        totalTime: z.string().optional().describe('ISO 8601 duration'),
        keywords: z.array(z.string()).optional().describe('Imported as tags'),
        sourceUrl: z.url().optional(),
        parseIngredients: parseArg,
      },
    },
    async (a) => {
      const schemaOrg = {
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: a.name,
        description: a.description,
        recipeIngredient: a.ingredients,
        recipeInstructions: a.instructions.map((text) => ({
          '@type': 'HowToStep',
          text,
        })),
        recipeYield: a.servings,
        prepTime: a.prepTime,
        cookTime: a.cookTime,
        totalTime: a.totalTime,
        keywords: a.keywords?.join(', '),
      }
      const slug = await mealie<string>(
        'POST',
        '/recipes/create/html-or-json',
        {
          body: {
            data: JSON.stringify(schemaOrg),
            url: a.sourceUrl,
            includeTags: Boolean(a.keywords?.length),
          },
        },
      )
      const { recipe, parsing } = await parseAfterSave(slug, a.parseIngredients)
      return json({ slug, parsing, recipe: recipeDetail(recipe) })
    },
  )

  server.registerTool(
    'update_recipe',
    {
      title: 'Update recipe',
      description:
        'Change fields of an existing recipe. Only the fields you pass are changed. Ingredients and instructions, if given, replace the existing lists.',
      inputSchema: {
        slug: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        servings: z
          .string()
          .optional()
          .describe('Text yield, e.g. "4 servings"'),
        ingredients: z
          .array(z.string())
          .optional()
          .describe('Replaces all ingredients; one per entry'),
        instructions: z
          .array(z.string())
          .optional()
          .describe('Replaces all steps; one per entry'),
        notes: z
          .array(z.object({ title: z.string().optional(), text: z.string() }))
          .optional()
          .describe('Replaces all notes'),
        parseIngredients: parseArg,
      },
    },
    async ({
      slug,
      name,
      description,
      servings,
      ingredients,
      instructions,
      notes,
      parseIngredients,
    }) => {
      const patch: Record<string, unknown> = {}
      if (name !== undefined) patch.name = name
      if (description !== undefined) patch.description = description
      if (servings !== undefined) patch.recipeYield = servings
      if (ingredients)
        patch.recipeIngredient = ingredients.map((note) => ({
          note,
          originalText: note,
          display: note,
        }))
      if (instructions)
        patch.recipeInstructions = instructions.map((text) => ({ text }))
      if (notes)
        patch.notes = notes.map((n) => ({ title: n.title ?? '', text: n.text }))
      const r = await mealie('PATCH', `/recipes/${encodeURIComponent(slug)}`, {
        body: patch,
      })
      if (!ingredients) return json(recipeDetail(r))
      const { recipe, parsing } = await parseAfterSave(r.slug, parseIngredients)
      return json({ parsing, recipe: recipeDetail(recipe) })
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
      const r = await parseLines(lines, parser)
      return json({
        parser: r.parser,
        lines: r.lines.map((l) => ({
          input: l.input,
          quantity: l.quantity,
          unit: l.unit?.name,
          food: l.food?.name,
          foodExists: Boolean(l.food?.id),
          note: l.note || undefined,
          confidence: l.confidence,
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
        'Set which store section (aisle) a food belongs to, e.g. "chicken thighs" -> "Meat". The section is created if it does not exist, and so is the food. Every future shopping list item linked to this food is sorted into that section.',
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
      const results = []
      for (const f of foods) {
        const food = await findOrCreateFood(f)
        await mealie('PUT', `/foods/${food.id}`, {
          body: { ...food, labelId: label.id },
        })
        results.push(food.name)
      }
      return json({
        section: label.name,
        sectionCreated: created,
        foods: results,
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
        'Plan a meal on a date. Give recipeId (from search_recipes) for a saved recipe, or a title for a free-text entry like "Leftovers".',
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
