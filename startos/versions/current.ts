import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:10',
  releaseNotes: {
    en_US:
      'AI connector: get_recipe shows the food each ingredient is linked to and its store section; new list_foods tool lists foods with their store sections (with optional search) to find duplicates; set_food_store_section reports whether each food matched an existing one or was created.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
