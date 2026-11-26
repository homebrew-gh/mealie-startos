// Bumps the package to a new upstream Mealie release, following UPDATING.md:
//   node .github/scripts/bump-mealie.mjs v3.32.0
// 1. Points the image in startos/manifest/index.ts at the new tag.
// 2. Moves startos/versions/current.ts to a file named for the old version and
//    lists it in versions/index.ts.
// 3. Writes a new current.ts with version <new>:0 and release notes.
//
// With --revision it keeps the Mealie image and only raises the package
// revision (3.31.0:15 -> 3.31.0:16), doing steps 2 and 3 with the given notes:
//   node .github/scripts/bump-mealie.mjs --revision "Rebuild with ..."
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

const dir = 'startos/versions'

// Steps 2 and 3: archive current.ts under its version and write a new one.
function writeNewCurrent(newVersion, notes) {
  const current = readFileSync(`${dir}/current.ts`, 'utf8')
  const oldVersion = current.match(/version:\s*'([^']+)'/)?.[1]
  if (!oldVersion) throw new Error('version not found in current.ts')
  const [oldUpstream, oldRevision] = oldVersion.split(':')
  if (typeof newVersion === 'function') {
    newVersion = newVersion(oldUpstream, Number(oldRevision))
  }
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
  version: '${newVersion}',
  releaseNotes: {
    en_US:
      '${notes.replace(/[\\']/g, '\\$&').replace(/\s*\n\s*/g, ' ')}',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
`,
  )
  return { oldVersion, newVersion }
}

if (process.argv[2] === '--revision') {
  const notes = process.argv[3]?.trim()
  if (!notes) {
    console.error('usage: bump-mealie.mjs --revision "release notes"')
    process.exit(1)
  }
  const { oldVersion, newVersion } = writeNewCurrent(
    (upstream, revision) => `${upstream}:${revision + 1}`,
    notes,
  )
  console.log(`Bumped ${oldVersion} -> ${newVersion}`)
  process.exit(0)
}

const tag = process.argv[2]
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
  console.error('usage: bump-mealie.mjs vX.Y.Z | --revision "release notes"')
  process.exit(1)
}
const upstream = tag.slice(1)

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

const { oldVersion } = writeNewCurrent(
  `${upstream}:0`,
  `Updates Mealie to ${tag}. See https://github.com/mealie-recipes/mealie/releases/tag/${tag} for what changed.`,
)
console.log(`Bumped ${oldTag} (${oldVersion}) -> ${tag} (${upstream}:0)`)
