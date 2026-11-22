import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const v3_31_0_6 = VersionInfo.of({
  version: '3.31.0:6',
  releaseNotes: {
    en_US:
      'AI connector: assistants are told to keep mains and sides as separate recipes and plan them in the same meal slot, so the YesChef app can cook a whole meal on one timeline. update_recipe can now set prep, cook and total times, and a new delete_recipe tool lets assistants remove old combined recipes after splitting them.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
