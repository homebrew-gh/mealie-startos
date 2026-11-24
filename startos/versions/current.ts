import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:14',
  releaseNotes: {
    en_US:
      'AI connector: new delete_food tool deletes a food only when no recipe or shopping list item uses it; search_recipes can find recipes by food, and list_foods can show how many recipes and list items use each food; merge_foods reports how many recipes and list items it moved over.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
