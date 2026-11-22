import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_1 = VersionInfo.of({
  version: '3.31.0:1',
  releaseNotes: {
    en_US:
      'Adds an optional AI connector: an MCP server, on its own interface, that lets Claude and other AI assistants read and change your recipes, meal plans and shopping lists. It is off until you configure it.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
