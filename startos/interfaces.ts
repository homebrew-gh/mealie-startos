import { i18n } from './i18n'
import { mcpUrl } from './mcpUrl'
import { primaryUrl } from './primaryUrl'
import { sdk } from './sdk'
import {
  mainHostId,
  mcpHostId,
  mcpInterfaceId,
  mcpPort,
  uiPort,
  webuiInterfaceId,
} from './utils'

// One interface serves both the web UI and the REST API (under /api, docs at
// /docs). StartOS publishes it on every LAN address — including the one the
// box has inside a WireGuard VPN — so API clients and the web UI share it.
export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const multi = sdk.MultiHost.of(effects, mainHostId)
  const origin = await multi.bindPort(uiPort, {
    protocol: 'http',
  })
  const preferredLauncherAddress = await primaryUrl.bestUsable(effects).const()
  const webui = sdk.createInterface(effects, {
    name: i18n('Web UI and API'),
    id: webuiInterfaceId,
    description: i18n(
      'The Mealie web interface. The REST API is served on the same address under /api.',
    ),
    type: 'ui',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '',
    query: {},
    preferredLauncherAddress,
  })

  const receipt = await origin.export([webui])

  // The AI connector gets its own host, so it can be given a public domain
  // (e.g. through StartTunnel) while Mealie itself stays private.
  const mcpMulti = sdk.MultiHost.of(effects, mcpHostId)
  const mcpOrigin = await mcpMulti.bindPort(mcpPort, { protocol: 'http' })
  const mcp = sdk.createInterface(effects, {
    name: i18n('AI Connector (MCP)'),
    id: mcpInterfaceId,
    description: i18n(
      'MCP server for AI assistants, at /mcp. Give it a public domain to use it from Claude and other cloud assistants. Sign-in needs the connector password.',
    ),
    type: 'api',
    masked: false,
    schemeOverride: null,
    username: null,
    path: '/mcp',
    query: {},
    preferredLauncherAddress: await mcpUrl.bestUsable(effects).const(),
  })
  const mcpReceipt = await mcpOrigin.export([mcp])

  return [receipt, mcpReceipt]
})
