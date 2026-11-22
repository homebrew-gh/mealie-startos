export const DEFAULT_LANG = 'en_US'

const dict = {
  'Time Zone': 0,
  'An IANA time zone name, such as America/New_York or Europe/London. Mealie uses it for dates on the server, such as which day counts as today in the meal planner.': 1,
  'Enter a name like America/New_York or UTC.': 2,
  'Set Time Zone': 3,
  'Set the time zone Mealie uses for dates.': 4,
  'Disable Open Sign-up': 5,
  'Enable Open Sign-up': 6,
  'Let anyone who can reach Mealie create an account without an invitation. Off by default; invitations from the admin page work either way.': 7,
  'Seeding configuration': 8,
  'Web UI and API': 9,
  'The Mealie web interface. The REST API is served on the same address under /api.': 10,
  'Starting Mealie!': 11,
  'Web Interface': 12,
  'The web interface is ready': 13,
  'The web interface is not ready': 14,
  'Set Primary URL': 15,
  'Choose the URL Mealie puts in links it generates, such as invitations, password resets and shared recipes. Open UI opens this address when your connection can reach it.': 16,
  'Primary URL': 17,
  'Used for links Mealie generates. Every address Mealie is reachable at works in the browser and the API regardless of this setting.': 18,
} as const

/**
 * Plumbing. DO NOT EDIT.
 */
export type I18nKey = keyof typeof dict
export type LangDict = Record<(typeof dict)[I18nKey], string>
export default dict
