import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:7',
  releaseNotes: {
    en_US:
      'AI connector fixes: prep, cook and total times given to create_recipe are now saved, and a zero time (PT0M, for example a no-cook sauce) is stored as "0 minutes" instead of being dropped.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
