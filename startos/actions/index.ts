import { mcpUrl } from '../mcpUrl'
import { primaryUrl } from '../primaryUrl'
import { sdk } from '../sdk'
import { configureConnector } from './configureConnector'
import { setTimezone } from './timezone'
import { toggleSignup } from './toggleSignup'

export const actions = sdk.Actions.of()
  .addAction(primaryUrl.action)
  .addAction(setTimezone)
  .addAction(toggleSignup)
  // Group: AI Connector
  .addAction(configureConnector)
  .addAction(mcpUrl.action)
