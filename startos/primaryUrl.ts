import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import { mainHostId, webuiInterfaceId } from './utils'

export const primaryUrl = sdk.setupPrimaryUrl({
  id: 'set-primary-url',
  hostId: mainHostId,
  interfaceId: webuiInterfaceId,
  metadata: {
    name: i18n('Set Primary URL'),
    description: i18n(
      'Choose the URL Mealie puts in links it generates, such as invitations, password resets and shared recipes. Open UI opens this address when your connection can reach it.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  },
  field: {
    name: i18n('Primary URL'),
    description: i18n(
      'Used for links Mealie generates. Every address Mealie is reachable at works in the browser and the API regardless of this setting.',
    ),
  },
  // The store keeps '' for an unset URL; the helper needs null to fall back.
  get: storeJson.read((s) => s.BASE_URL || null),
  set: (effects, url) => storeJson.merge(effects, { BASE_URL: url }),
})
