import { sdk } from './sdk'

export const { createBackup, restoreInit } = sdk.setupBackups(async () =>
  // 'main' is Mealie's whole data directory (SQLite database, recipe images,
  // Mealie's own backup zips, and the generated SECRET/SESSION_SECRET files
  // that keep logins and API tokens valid). 'startos' holds store.json; 'mcp'
  // holds the AI connector's OAuth clients and tokens.
  sdk.Backups.ofVolumes('main', 'startos', 'mcp').setOptions({
    exclude: ['.temp', '*-shm'],
  }),
)
