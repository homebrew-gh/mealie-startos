import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:2',
  releaseNotes: {
    en_US:
      "AI connector: recipes created or imported by an assistant now go through Mealie's ingredient parser, and assistants can set store sections (aisles) on foods and shopping items so lists sort by aisle.",
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
