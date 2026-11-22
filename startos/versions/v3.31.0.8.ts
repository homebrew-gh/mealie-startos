import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_8 = VersionInfo.of({
  version: '3.31.0:8',
  releaseNotes: {
    en_US:
      'AI connector: create_recipe and update_recipe can now set nutrition facts per serving (calories, protein, carbs, fat, fiber, sugar, sodium and more), and get_recipe returns them. Setting nutrition also turns on the recipe\'s nutrition display in Mealie.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
