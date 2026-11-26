import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:17',
  releaseNotes: {
    en_US:
      'Structured recipe step schema (#25): Switched recipe instructions from a string | object union (anyOf) to a direct object schema ({ text, title?, summary?, ingredients? }) so MCP clients advertise step summaries and 0-based ingredient links clearly instead of flattening steps to plain text. Phased & nested timing guidance (#26): Added schema and server instructions telling agents to split mid-cook timing changes (e.g. covering/uncovering with foil, flipping, lowering oven temp, adding toppings partway) into separate sequential steps so each step gets one unambiguous timer and meal timelines stay accurate.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
