export const DEFAULT_LANG = 'en_US'

const dict = {
  'Enable AI Connector': 0,
  'Run the MCP server that lets AI assistants such as Claude read and change your recipes, meal plans and shopping lists.': 1,
  'Mealie API Token': 2,
  'Create one in Mealie under your profile, API Tokens. The connector acts as that Mealie user.': 3,
  'Connector Password': 4,
  'You type this on the approval page when you connect an AI assistant. Anyone with it can connect an assistant to your Mealie, so make it long.': 5,
  'Configure AI Connector': 6,
  'Turn the AI connector on or off and set the Mealie API token and connector password it uses.': 7,
  'AI Connector': 8,
  'Time Zone': 9,
  'An IANA time zone name, such as America/New_York or Europe/London. Mealie uses it for dates on the server, such as which day counts as today in the meal planner.': 10,
  'Enter a name like America/New_York or UTC.': 11,
  'Set Time Zone': 12,
  'Set the time zone Mealie uses for dates.': 13,
  'Disable Open Sign-up': 14,
  'Enable Open Sign-up': 15,
  'Let anyone who can reach Mealie create an account without an invitation. Off by default; invitations from the admin page work either way.': 16,
  'Seeding configuration': 17,
  'Web UI and API': 18,
  'The Mealie web interface. The REST API is served on the same address under /api.': 19,
  'AI Connector (MCP)': 20,
  'MCP server for AI assistants, at /mcp. Give it a public domain to use it from Claude and other cloud assistants. Sign-in needs the connector password.': 21,
  'Starting Mealie!': 22,
  'Web Interface': 23,
  'The web interface is ready': 24,
  'The web interface is not ready': 25,
  'The AI connector is ready': 26,
  'The AI connector is not ready': 27,
  'Set AI Connector URL': 28,
  'Choose the public HTTPS address AI assistants use to reach the AI connector. Add a public domain to the AI Connector interface first.': 29,
  'Connector URL': 30,
  'A public domain on the AI Connector interface. The connector address to give your AI assistant is this URL followed by /mcp.': 31,
  'Set Primary URL': 32,
  'Choose the URL Mealie puts in links it generates, such as invitations, password resets and shared recipes. Open UI opens this address when your connection can reach it.': 33,
  'Primary URL': 34,
  'Used for links Mealie generates. Every address Mealie is reachable at works in the browser and the API regardless of this setting.': 35,
} as const

/**
 * Plumbing. DO NOT EDIT.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
