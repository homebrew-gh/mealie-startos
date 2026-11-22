import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

const { InputSpec, Value } = sdk

const inputSpec = InputSpec.of({
  enabled: Value.toggle({
    name: i18n('Enable AI Connector'),
    description: i18n(
      'Run the MCP server that lets AI assistants such as Claude read and change your recipes, meal plans and shopping lists.',
    ),
    default: false,
  }),
  mealieToken: Value.text({
    name: i18n('Mealie API Token'),
    description: i18n(
      'Create one in Mealie under your profile, API Tokens. The connector acts as that Mealie user.',
    ),
    required: false,
    default: null,
    masked: true,
  }),
  password: Value.text({
    name: i18n('Connector Password'),
    description: i18n(
      'You type this on the approval page when you connect an AI assistant. Anyone with it can connect an assistant to your Mealie, so make it long.',
    ),
    required: false,
    default: null,
    masked: true,
    minLength: 12,
    generate: { charset: 'a-z,A-Z,0-9', len: 24 },
  }),
})

export const configureConnector = sdk.Action.withInput(
  'configure-connector',
  {
    name: i18n('Configure AI Connector'),
    description: i18n(
      'Turn the AI connector on or off and set the Mealie API token and connector password it uses.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: i18n('AI Connector'),
    visibility: 'enabled',
  },
  inputSpec,
  async () => {
    const m = await storeJson.read((s) => s.mcp).once()
    return {
      enabled: m?.enabled ?? false,
      mealieToken: m?.mealieToken || undefined,
      password: m?.password || undefined,
    }
  },
  async ({ effects, input }) => {
    if (input.enabled && (!input.mealieToken || !input.password)) {
      throw new Error(
        'To enable the AI connector, enter both a Mealie API token and a connector password.',
      )
    }
    const m = await storeJson.read((s) => s.mcp).once()
    await storeJson.merge(effects, {
      mcp: {
        publicUrl: m?.publicUrl ?? '',
        enabled: input.enabled,
        mealieToken: input.mealieToken ?? '',
        password: input.password ?? '',
      },
    })
  },
)
