import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { defaultTimezone } from '../utils'

const { InputSpec, Value } = sdk

const inputSpec = InputSpec.of({
  tz: Value.text({
    name: i18n('Time Zone'),
    description: i18n(
      'An IANA time zone name, such as America/New_York or Europe/London. Mealie uses it for dates on the server, such as which day counts as today in the meal planner.',
    ),
    required: true,
    default: defaultTimezone,
    placeholder: 'America/New_York',
    patterns: [
      {
        regex: '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)*$',
        description: i18n('Enter a name like America/New_York or UTC.'),
      },
    ],
  }),
})

export const setTimezone = sdk.Action.withInput(
  'set-timezone',
  {
    name: i18n('Set Time Zone'),
    description: i18n('Set the time zone Mealie uses for dates.'),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  },
  inputSpec,
  async () => ({
    tz: (await storeJson.read((s) => s.TZ).once()) || defaultTimezone,
  }),
  async ({ effects, input }) => storeJson.merge(effects, { TZ: input.tz }),
)
