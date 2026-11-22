import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { primaryUrl } from './primaryUrl'
import { sdk } from './sdk'
import { dataMount, defaultTimezone, uiPort } from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting Mealie!'))

  const store = await storeJson.read().const(effects)
  const baseUrl =
    store?.BASE_URL || (await primaryUrl.bestUsable(effects).const()) || ''

  const env: Record<string, string> = {
    // SQLite is Mealie's default; pinned so a stray upstream default change
    // can never point it at a Postgres that doesn't exist.
    DB_ENGINE: 'sqlite',
    API_PORT: String(uiPort),
    TZ: store?.TZ || defaultTimezone,
    ALLOW_SIGNUP: store?.ALLOW_SIGNUP ?? 'false',
  }
  // Mealie treats its built-in default (http://localhost:8080) as "unset" and
  // warns on the admin page; only override it with a real address.
  if (baseUrl) env.BASE_URL = baseUrl

  return sdk.Daemons.of(effects).addDaemon('mealie', {
    subcontainer: sdk.SubContainer.of(
      effects,
      { imageId: 'mealie' },
      dataMount,
      'mealie-sub',
    ),
    exec: {
      command: sdk.useEntrypoint(),
      env,
    },
    ready: {
      display: i18n('Web Interface'),
      fn: () =>
        // Same endpoint the upstream image's own HEALTHCHECK polls.
        sdk.healthCheck.checkWebUrl(
          effects,
          `http://127.0.0.1:${uiPort}/api/app/about`,
          {
            timeout: 5_000,
            successMessage: i18n('The web interface is ready'),
            errorMessage: i18n('The web interface is not ready'),
          },
        ),
      // First start runs every database migration and seeds data; give it time.
      gracePeriod: 120_000,
    },
    requires: [],
  })
})
