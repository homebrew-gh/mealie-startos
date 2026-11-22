import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import { mcpHostId, mcpInterfaceId } from './utils'

// The connector's public HTTPS address. It is the OAuth issuer and the MCP
// resource, so it must be one fixed address that AI services on the internet
// can reach: only public domains served over TLS are offered.
export const mcpUrl = sdk.setupPrimaryUrl({
  id: 'set-connector-url',
  hostId: mcpHostId,
  interfaceId: mcpInterfaceId,
  metadata: {
    name: i18n('Set AI Connector URL'),
    description: i18n(
      'Choose the public HTTPS address AI assistants use to reach the AI connector. Add a public domain to the AI Connector interface first.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: i18n('AI Connector'),
    visibility: 'enabled',
  },
  field: {
    name: i18n('Connector URL'),
    description: i18n(
      'A public domain on the AI Connector interface. The connector address to give your AI assistant is this URL followed by /mcp.',
    ),
  },
  get: storeJson.read((s) => s.mcp?.publicUrl || null),
  set: async (effects, url) => {
    const mcp = (await storeJson.read((s) => s.mcp).once()) ?? undefined
    await storeJson.merge(effects, {
      mcp: {
        enabled: false,
        mealieToken: '',
        password: '',
        ...mcp,
        publicUrl: url,
      },
    })
  },
  filter: { visibility: 'public', kind: 'domain' },
  ssl: true,
})
