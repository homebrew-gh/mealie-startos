import { FileHelper, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'
import { defaultTimezone } from '../utils'

// Keys are the Mealie env vars they populate, stored in the string form the
// env expects, so main.ts passes them straight through.
const shape = z.looseObject({
  BASE_URL: z.string().catch(''),
  TZ: z.string().catch(defaultTimezone),
  ALLOW_SIGNUP: z.enum(['true', 'false']).catch('false'),

  // AI connector (MCP server). Not Mealie env vars.
  mcp: z
    .looseObject({
      enabled: z.boolean().catch(false),
      mealieToken: z.string().catch(''),
      password: z.string().catch(''),
      publicUrl: z.string().catch(''),
    })
    .catch({ enabled: false, mealieToken: '', password: '', publicUrl: '' }),
})

export const storeJson = FileHelper.json(
  { base: sdk.volumes.startos, subpath: './store.json' },
  shape,
)

export type Store = z.infer<typeof shape>
