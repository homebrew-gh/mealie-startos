import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_12 = VersionInfo.of({
  version: '3.31.0:12',
  releaseNotes: {
    en_US:
      'AI connector fixes: an ingredient is linked to the food with its exact name instead of a similar-looking food the parser picked (for example "simple syrup" instead of "maple syrup"); saving several recipes at once no longer fails when they create the same tag or food; create_recipe accepts notes, keeps the recipe if a later step fails, and will not save a second copy under an existing name unless asked.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
