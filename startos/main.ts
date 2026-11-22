import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { mcpUrl } from './mcpUrl'
import { primaryUrl } from './primaryUrl'
import { sdk } from './sdk'
import { dataMount, defaultTimezone, mcpMount, mcpPort, uiPort } from './utils'

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

  const daemons = sdk.Daemons.of(effects).addDaemon('mealie', {
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

  // ---------------- AI connector ----------------
  const mcp = store?.mcp
  const connectorUrl = await mcpUrl.bestUsable(effects).const()
  if (!mcp?.enabled) return daemons
  if (
    !mcp.mealieToken ||
    !mcp.password ||
    !connectorUrl?.startsWith('https://')
  ) {
    console.warn(
      'AI connector is enabled but not started: it needs a Mealie API token, a connector password and a public HTTPS connector URL.',
    )
    return daemons
  }

  const mcpSub = sdk.SubContainer.of(
    effects,
    { imageId: 'mcp' },
    mcpMount,
    'mcp-sub',
  )

  return daemons
    .addOneshot('mcp-chown', {
      subcontainer: mcpSub,
      exec: { command: ['chown', '-R', 'node:node', '/data'], user: 'root' },
      requires: [],
    })
    .addDaemon('mcp', {
      subcontainer: mcpSub,
      exec: {
        command: ['node', 'dist/index.js'],
        cwd: '/app',
        user: 'node',
        env: {
          PORT: String(mcpPort),
          PUBLIC_URL: connectorUrl,
          MEALIE_URL: `http://127.0.0.1:${uiPort}`,
          MEALIE_API_TOKEN: mcp.mealieToken,
          CONNECTOR_PASSWORD: mcp.password,
          STATE_FILE: '/data/oauth-state.json',
        },
      },
      ready: {
        display: i18n('AI Connector'),
        fn: () =>
          sdk.healthCheck.checkWebUrl(
            effects,
            `http://127.0.0.1:${mcpPort}/healthz`,
            {
              timeout: 5_000,
              successMessage: i18n('The AI connector is ready'),
              errorMessage: i18n('The AI connector is not ready'),
            },
          ),
        gracePeriod: 30_000,
      },
      requires: ['mcp-chown', 'mealie'],
    })
})
