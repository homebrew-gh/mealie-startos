// Bumps the package to a new upstream Mealie release, following UPDATING.md:
//   node .github/scripts/bump-mealie.mjs v3.32.0
// 1. Points the image in startos/manifest/index.ts at the new tag.
// 2. Moves startos/versions/current.ts to a file named for the old version and
//    lists it in versions/index.ts.
// 3. Writes a new current.ts with version <new>:0 and release notes.
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

const tag = process.argv[2]
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
  console.error('usage: bump-mealie.mjs vX.Y.Z')
  process.exit(1)
}
const upstream = tag.slice(1)
const dir = 'startos/versions'

const manifestPath = 'startos/manifest/index.ts'
const manifest = readFileSync(manifestPath, 'utf8')
const imageRe = /(ghcr\.io\/mealie-recipes\/mealie:)(v[^'"]+)/
const oldTag = manifest.match(imageRe)?.[2]
if (!oldTag) throw new Error('Mealie image tag not found in manifest')
if (oldTag === tag) {
  console.log(`Already on ${tag}`)
  process.exit(0)
}
writeFileSync(manifestPath, manifest.replace(imageRe, `$1${tag}`))

const current = readFileSync(`${dir}/current.ts`, 'utf8')
const oldVersion = current.match(/version:\s*'([^']+)'/)?.[1]
if (!oldVersion) throw new Error('version not found in current.ts')
const [oldUpstream, oldRevision] = oldVersion.split(':')
const oldFile = `v${oldUpstream}.${oldRevision}`
const oldExport = oldFile.replace(/\./g, '_')
writeFileSync(
  `${dir}/current.ts`,
  current.replace('export const current', `export const ${oldExport}`),
)
renameSync(`${dir}/current.ts`, `${dir}/${oldFile}.ts`)

let index = readFileSync(`${dir}/index.ts`, 'utf8')
index = index.replace(
  "import { current } from './current'\n",
  `import { current } from './current'\nimport { ${oldExport} } from './${oldFile}'\n`,
)
index = index.replace(/other:\s*\[/, `other: [${oldExport}, `)
writeFileSync(`${dir}/index.ts`, index)

writeFileSync(
  `${dir}/current.ts`,
  `import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '${upstream}:0',
  releaseNotes: {
    en_US:
      'Updates Mealie to ${tag}. See https://github.com/mealie-recipes/mealie/releases/tag/${tag} for what changed.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
`,
)
console.log(`Bumped ${oldTag} (${oldVersion}) -> ${tag} (${upstream}:0)`)
