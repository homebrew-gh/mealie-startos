import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

export const toggleSignup = sdk.Action.withoutInput(
  'toggle-signup',
  async ({ effects }) => {
    const on =
      (await storeJson.read((s) => s.ALLOW_SIGNUP).const(effects)) === 'true'
    return {
      name: on ? i18n('Disable Open Sign-up') : i18n('Enable Open Sign-up'),
      description: i18n(
        'Let anyone who can reach Mealie create an account without an invitation. Off by default; invitations from the admin page work either way.',
      ),
      warning: null,
      allowedStatuses: 'any',
      group: null,
      visibility: 'enabled',
    }
  },
  async ({ effects }) => {
    const on = (await storeJson.read((s) => s.ALLOW_SIGNUP).once()) === 'true'
    await storeJson.merge(effects, { ALLOW_SIGNUP: on ? 'false' : 'true' })
  },
)
