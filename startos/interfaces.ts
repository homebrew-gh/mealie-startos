import { i18n } from './i18n'
import { primaryUrl } from './primaryUrl'
import { sdk } from './sdk'
import { mainHostId, uiPort, webuiInterfaceId } from './utils'

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

  return [receipt]
})
