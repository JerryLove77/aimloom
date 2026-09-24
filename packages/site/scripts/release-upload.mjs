// Puts each release file that is hosted on R2 (https://dl.aimloom.dev/releases/<name>) into the
// public bucket, after checking it is exactly the file src/data/releases.json describes, and then
// reads it back over the public URL. A release that carries PowerShell 7 is about 100 MB, over
// the 25 MiB a Worker's static asset may be, so it cannot be staged into dist/files/.
//
//   node scripts/release-upload.mjs            # reads release-files/<name>; uploads what is missing
//   node scripts/release-upload.mjs --dry-run  # checks and prints, uploads nothing
//
// Keys are never reused: a file already live under its name must have the described size, or the
// run stops; it is never overwritten. The upload goes through the maintainer's `wrangler login`.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASE_ORIGIN = 'https://dl.aimloom.dev/releases/'
const HOSTED = /^https:\/\/dl\.aimloom\.dev\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.(zip|exe)$/
const BUCKET = 'aimloom-files'
const CONTENT_TYPE = { zip: 'application/zip', exe: 'application/vnd.microsoft.portable-executable' }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** The release files hosted on R2, each checked against its local copy in `source`; throws on any mismatch. */
export function hostedReleaseFiles({ source, releasesPath }) {
  const data = JSON.parse(readFileSync(releasesPath, 'utf8'))
  const files = []
  for (const release of data.releases) {
    // A withdrawn release is a changelog record only; a preparing one has nothing to host yet.
    if (release.status === 'preparing' || release.status === 'withdrawn') continue
    const described = [{ url: release.primaryUrl, bytes: release.bytes, sha256: release.sha256 }]
    if (release.setup) described.push(release.setup)
    for (const file of described) {
      if (typeof file.url !== 'string' || !HOSTED.test(file.url)) continue
      const name = basename(file.url)
      const from = join(source, name)
      if (!existsSync(from)) throw new Error(`v${release.version}: expected ${name} at ${from}. Copy the file attached to the GitHub release there.`)
      const actualBytes = statSync(from).size
      if (actualBytes !== file.bytes) throw new Error(`v${release.version}: ${from} is ${actualBytes} bytes; releases.json says ${file.bytes}.`)
      const actual = sha256(readFileSync(from))
      if (actual !== file.sha256) throw new Error(`v${release.version}: ${from} has SHA-256 ${actual}; releases.json says ${file.sha256}.`)
      const extension = name.endsWith('.exe') ? 'exe' : 'zip'
      files.push({ version: release.version, url: file.url, key: `releases/${name}`, path: from, bytes: file.bytes, sha256: file.sha256,
        contentType: CONTENT_TYPE[extension], disposition: `attachment; filename="${name}"` })
    }
  }
  return files
}

/**
 * What the public URL holds now: 'missing' (404), 'live' (the described size), or a thrown error
 * for anything else — another size under the same name is never replaced.
 */
export async function liveState(file, fetchImpl = fetch) {
  const response = await fetchImpl(file.url, { method: 'HEAD', redirect: 'manual' })
  if (response.status === 404) return 'missing'
  if (response.status !== 200) throw new Error(`${file.url} answered ${response.status}; expected 200 or 404.`)
  const length = Number(response.headers.get('content-length'))
  if (length !== file.bytes) throw new Error(`${file.url} is already live with ${length} bytes, not ${file.bytes}. Keys are never reused: give the file a new name.`)
  return 'live'
}

/** Downloads the public URL and checks every byte; throws if it is not exactly the described file. */
export async function verifyLive(file, fetchImpl = fetch) {
  const response = await fetchImpl(file.url, { redirect: 'manual' })
  if (response.status !== 200) throw new Error(`${file.url} answered ${response.status} after the upload.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`${file.url} does not read back as the uploaded file (${bytes.length} bytes, SHA-256 ${sha256(bytes)}).`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = hostedReleaseFiles({ source: join(site, 'release-files'), releasesPath: join(site, 'src/data/releases.json') })
  if (!files.length) { console.log('no release file is hosted on R2'); return }
  for (const file of files) {
    const state = await liveState(file)
    if (state === 'live') { console.log(`live: ${file.url} (${file.bytes} bytes)`); continue }
    const argv = ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${file.key}`, '--file', file.path, '--content-type', file.contentType,
      '--cache-control', 'public, max-age=31536000, immutable', '--content-disposition', file.disposition, '--remote']
    console.log(`${dryRun ? '[dry run] ' : ''}npx ${argv.join(' ')}`)
    if (dryRun) continue
    const r = spawnSync('npx', argv, { cwd: site, stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`wrangler exited with ${r.status}; ${file.key} may not be uploaded.`)
    await verifyLive(file)
    console.log(`uploaded and read back: ${file.url} (${file.bytes} bytes, SHA-256 ${file.sha256})`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
