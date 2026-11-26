import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_15 = VersionInfo.of({
  version: '3.31.0:15',
  releaseNotes: {
    en_US:
      'AI connector: create_recipe and update_recipe can group ingredients under subheadings such as "Marinade" (Mealie ingredient sections), and get_recipe shows which subheading each ingredient starts.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
