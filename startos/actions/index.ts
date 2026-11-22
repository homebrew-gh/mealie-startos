import { primaryUrl } from '../primaryUrl'
import { sdk } from '../sdk'
import { setTimezone } from './timezone'
import { toggleSignup } from './toggleSignup'

export const actions = sdk.Actions.of()
  .addAction(primaryUrl.action)
  .addAction(setTimezone)
  .addAction(toggleSignup)
