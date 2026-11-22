import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '3.31.0:3',
  releaseNotes: {
    en_US:
      'AI connector: assistants can now file recipes into categories and tags (create_recipe and update_recipe take category and tag names, and list_organizers shows what exists), and mark a recipe as cooked, which updates its last-made date. create_recipe now takes tags instead of keywords.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
