import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_11 = VersionInfo.of({
  version: '3.31.0:11',
  releaseNotes: {
    en_US:
      'AI connector: new list_cook_notes tool lists the notes taken while cooking (the cooking notes the YesChef app saves from cook mode, and "I made this" comments) for a day or date range, so an assistant can review how a cook went and suggest recipe fixes for next time. The connector now uses the time zone from the Set Time Zone action.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
