import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:9',
  releaseNotes: {
    en_US:
      'AI connector: get_recipe returns nutrition under the same "nutrition" name and units that create_recipe and update_recipe take, and its description lists the times and nutrition it returns, so assistants can confirm what was saved.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
