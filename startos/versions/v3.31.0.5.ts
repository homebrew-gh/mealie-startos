import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_5 = VersionInfo.of({
  version: '3.31.0:5',
  releaseNotes: {
    en_US:
      'AI connector: ingredient lines that combine foods, such as "salt and pepper, to taste", are now split into one ingredient per food before Mealie parses them, so each links to its own food. Foods with "and" in their name, such as half and half, are left alone.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
