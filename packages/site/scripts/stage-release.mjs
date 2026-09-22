// Copies each release ZIP the site serves itself into dist/files/, after checking it is exactly
// the file src/data/releases.json describes. Run after `astro build`, before deploying.
//
//   node scripts/stage-release.mjs            # reads release-files/<name>.zip
//
// The ZIP is never committed. It is the file built on Windows and attached to the GitHub
// release; put a copy in packages/site/release-files/ (gitignored) before deploying.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_FILE = /^\/files\/[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/
const SITE_SETUP = /^\/files\/[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Copies one release file into dist/files/ and returns it; throws if it is missing or its bytes or SHA-256 differ. */
function stageOne(release, file, bytes, sha256Expected, dist, source) {
  const from = join(source, file)
  if (!existsSync(from)) throw new Error(`v${release.version}: expected ${file} at ${from}. Copy the file attached to the GitHub release there.`)
  const actualBytes = statSync(from).size
  if (actualBytes !== bytes) throw new Error(`v${release.version}: ${from} is ${actualBytes} bytes; releases.json says ${bytes}.`)
  const actual = sha256(from)
  if (actual !== sha256Expected) throw new Error(`v${release.version}: ${from} has SHA-256 ${actual}; releases.json says ${sha256Expected}.`)
  const to = join(dist, 'files', file)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  // A copy that does not read back identical is removed rather than deployed.
  if (sha256(to) !== sha256Expected) { rmSync(to, { force: true }); throw new Error(`v${release.version}: the copy in ${to} does not match; nothing was staged.`) }
  return { file, bytes: actualBytes }
}

/** @returns {{ file: string, bytes: number }[]} the files staged */
export function stageRelease({ dist, source, releasesPath }) {
  if (!existsSync(dist) || !statSync(dist).isDirectory()) throw new Error(`${dist} does not exist: run astro build first.`)
  const data = JSON.parse(readFileSync(releasesPath, 'utf8'))
  const staged = []
  for (const release of data.releases) {
    // A withdrawn release is a changelog record only: its files are no longer served.
    if (release.status === 'preparing' || release.status === 'withdrawn') continue
    if (typeof release.primaryUrl === 'string' && SITE_FILE.test(release.primaryUrl)) {
      staged.push(stageOne(release, basename(release.primaryUrl), release.bytes, release.sha256, dist, source))
    }
    if (release.setup && typeof release.setup.url === 'string' && SITE_SETUP.test(release.setup.url)) {
      staged.push(stageOne(release, basename(release.setup.url), release.setup.bytes, release.setup.sha256, dist, source))
    }
  }
  return staged
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const staged = stageRelease({ dist: join(site, 'dist'), source: join(site, 'release-files'), releasesPath: join(site, 'src/data/releases.json') })
    for (const s of staged) console.log(`staged files/${s.file} (${s.bytes} bytes)`)
    if (!staged.length) console.log('no release ZIP is served from the site')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
