import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_0 = VersionInfo.of({
  version: '3.31.0:0',
  releaseNotes: {
    en_US: 'Initial StartOS package of Mealie 3.31.0.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
