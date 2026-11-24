import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:13',
  releaseNotes: {
    en_US:
      'AI connector: new merge_foods tool merges duplicate foods into one and moves their recipes and shopping list items over; set_recipe_image takes a batch of images and reports slow downloads as still saving instead of timing out; create_recipe and update_recipe return each ingredient with its linked food and store section, like get_recipe.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
