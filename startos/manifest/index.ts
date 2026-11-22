import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'mealie',
  title: 'Mealie',
  license: 'AGPL-3.0',
  packageRepo: 'https://github.com/homebrew-gh/mealie-startos',
  upstreamRepo: 'https://github.com/mealie-recipes/mealie',
  marketingUrl: 'https://mealie.io/',
  donationUrl: 'https://github.com/sponsors/hay-kot',
  description: { short, long },
  // 'main' is Mealie's /app/data: SQLite database, recipe images, Mealie's own
  // backup zips and its generated secrets. 'startos' holds store.json.
  volumes: ['main', 'startos'],
  images: {
    mealie: {
      source: { dockerTag: 'ghcr.io/mealie-recipes/mealie:v3.31.0' },
      arch: ['x86_64', 'aarch64'],
    },
  },
})
