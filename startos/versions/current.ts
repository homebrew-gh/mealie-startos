import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:4',
  releaseNotes: {
    en_US:
      'AI connector: new add_meal_plan_to_shopping_list tool adds every planned recipe in a date range to a shopping list in one call, and clear_shopping_list empties one list (or just its checked-off items), so an assistant can keep its own weekly list.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
