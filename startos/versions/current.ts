import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:16',
  releaseNotes: {
    en_US:
      'AI Connector (MCP)  Structured steps & cleaner recipes  create_recipe and update_recipe now accept structured instructions (text, title, summary, and 0-based ingredients indexes) to populate Mealie ingredientReferences so YesChef\'s cook-mode "You\'ll need" boxes are exact, while keeping passive steps (preheat, bake, rest, serve) clean. Ingredient referenceIds are preserved across recipe edits and propagated when combined lines ("salt and pepper") are split. get_recipe, create_recipe, update_recipe, and import_recipe_from_url now report unlabeledFoods and actionable gaps, keep numeric recipeServings in sync for scaling, and support recipe tools (equipment) and rating.  Smarter food matching & catalog cleanup  Replaced brittle food matching with alias-aware, catalog-wide matching (foodMatch) and head-noun/qualifier guardrails (so e.g. "peanut butter" no longer links to "butter"). Added update_food (rename, aliases, description, store section) and find_duplicate_foods to clean up near-duplicates. merge_foods can optionally keep merged names as aliases (addAsAlias), list_foods adds unlabeledOnly / unusedOnly / aliases, and add_shopping_list_items parses amounts/units and links foods so items land in the right store section.  Cooking-note review loop & context  Added changeSummary on update_recipe and a log_recipe_change tool; list_cook_notes now reports status: "pending" | "reviewed" and supports onlyPending: true. Added server-level MCP instructions (cookbook organizing scheme, meal-plan rules, and post-import checklist), plus shopping-list recipe/section ordering and meal-plan recipe times.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
