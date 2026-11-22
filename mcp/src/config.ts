function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const publicUrl = new URL(required('PUBLIC_URL'))
if (publicUrl.protocol !== 'https:') {
  throw new Error('PUBLIC_URL must be an https:// address')
}
publicUrl.pathname = '/'
publicUrl.search = ''
publicUrl.hash = ''

export const config = {
  port: Number(process.env.PORT ?? 8000),
  /** Public base URL of this server, e.g. https://mcp.example.com/ */
  publicUrl,
  /** The MCP endpoint, which is also the OAuth protected resource. */
  mcpUrl: new URL('/mcp', publicUrl),
  mealieUrl: (process.env.MEALIE_URL ?? 'http://127.0.0.1:9000').replace(
    /\/+$/,
    '',
  ),
  mealieToken: required('MEALIE_API_TOKEN'),
  connectorPassword: required('CONNECTOR_PASSWORD'),
  stateFile: process.env.STATE_FILE ?? '/data/oauth-state.json',
}
