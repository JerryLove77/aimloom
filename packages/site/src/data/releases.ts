import raw from './releases.json'

/** `withdrawn`: no longer offered for download; kept, with its facts, as a changelog record. */
export type ReleaseStatus = 'preparing' | 'beta' | 'stable' | 'withdrawn'
export interface Localized { zh: string; en: string }
export interface LocalizedList { zh: string[]; en: string[] }
export interface SetupFile { url: string; bytes: number; sha256: string }
export interface Release {
  version: string
  status: ReleaseStatus
  date: string | null
  platform: string
  requires: string[]
  bytes: number | null
  sha256: string | null
  primaryUrl: string | null
  mirrorUrl: string | null
  contents: string[]
  notes: Localized
  knownIssues: LocalizedList
  setup: SetupFile | null
}
export interface ReleaseData { schemaVersion: 1; recommended: string | null; beta: string | null; releases: Release[] }

const STATUSES: readonly ReleaseStatus[] = ['preparing', 'beta', 'stable', 'withdrawn']
const RELEASE_KEYS = ['version', 'status', 'date', 'platform', 'requires', 'bytes', 'sha256', 'primaryUrl', 'mirrorUrl', 'contents', 'notes', 'knownIssues', 'setup'] as const
const TOP_KEYS = ['schemaVersion', 'recommended', 'beta', 'releases'] as const
/** A release ZIP served by the site itself; scripts/stage-release.mjs copies it into dist/files/. */
export const SITE_FILE = /^\/files\/[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/
/** A Windows Setup served by the site itself, beside the ZIP; staged and checked the same way. */
export const SITE_SETUP = /^\/files\/[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/
/**
 * A release file in the public R2 bucket, for files over the 25 MiB a Worker's static asset may be
 * (every release that carries PowerShell 7). scripts/release-upload.mjs puts it there; the deploy
 * checks it is live with the described size.
 */
export const HOSTED_FILE = /^https:\/\/dl\.aimloom\.dev\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/
export const HOSTED_SETUP = /^https:\/\/dl\.aimloom\.dev\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/

function fail(message: string): never { throw new Error(`releases.json: ${message}`) }

/** Semver precedence, including prereleases: `0.1.3 < 0.1.4-beta.1 < 0.1.4-beta.2 < 0.1.4`. */
function parseSemver(v: string, name: string): { core: [number, number, number]; prerelease: (string | number)[] | null } {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v)
  if (m === null) fail(`${name} "${v}" is not a valid version`)
  const core: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const prerelease = m[4] !== undefined ? m[4].split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id)) : null
  return { core, prerelease }
}
/** True when `candidate` outranks `base` by semver precedence. */
export function isNewer(candidate: string, base: string): boolean {
  const a = parseSemver(candidate, 'version'), b = parseSemver(base, 'version')
  for (let i = 0; i < 3; i++) { if (a.core[i] !== b.core[i]) return a.core[i]! > b.core[i]! }
  if (a.prerelease === null && b.prerelease === null) return false
  if (a.prerelease === null) return true // a release outranks any prerelease of the same numbers
  if (b.prerelease === null) return false
  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i++) {
    const x = a.prerelease[i], y = b.prerelease[i]
    if (x === undefined) return false // fewer fields sorts lower
    if (y === undefined) return true
    if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x > y; continue }
    if (typeof x === 'number') return false // a numeric identifier sorts lower than an alphanumeric one
    if (typeof y === 'number') return true
    if (x !== y) return x > y
  }
  return false
}
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v) }
function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(`unknown key "${k}" in ${where}`)
}
function str(v: unknown, name: string): string { if (typeof v !== 'string' || v.length === 0) fail(`${name} must be a non-empty string`); return v }
function strOrNull(v: unknown, name: string): string | null { return v === null ? null : str(v, name) }
function strList(v: unknown, name: string): string[] { if (!Array.isArray(v)) fail(`${name} must be a list`); return v.map((x, i) => str(x, `${name}[${i}]`)) }
function localized(v: unknown, name: string): Localized {
  if (!isRecord(v)) fail(`${name} must be {zh, en}`); onlyKeys(v, ['zh', 'en'], name)
  return { zh: str(v.zh, `${name}.zh`), en: str(v.en, `${name}.en`) }
}
function localizedList(v: unknown, name: string): LocalizedList {
  if (!isRecord(v)) fail(`${name} must be {zh, en}`); onlyKeys(v, ['zh', 'en'], name)
  return { zh: strList(v.zh, `${name}.zh`), en: strList(v.en, `${name}.en`) }
}
function setupFile(v: unknown, where: string): SetupFile | null {
  if (v === null || v === undefined) return null
  if (!isRecord(v)) fail(`${where}.setup must be {url, bytes, sha256} or null`)
  onlyKeys(v, ['url', 'bytes', 'sha256'], `${where}.setup`)
  const url = str(v.url, `${where}.setup.url`)
  if (!SITE_SETUP.test(url) && !HOSTED_SETUP.test(url)) fail(`${where}.setup.url must be /files/<name>.exe or https://dl.aimloom.dev/releases/<name>.exe`)
  if (typeof v.bytes !== 'number' || !Number.isInteger(v.bytes) || v.bytes <= 0) fail(`${where}.setup.bytes must be a positive integer`)
  const sha256 = str(v.sha256, `${where}.setup.sha256`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail(`${where}.setup.sha256 must be 64 lowercase hex characters`)
  return { url, bytes: v.bytes, sha256 }
}

function parseRelease(v: unknown, i: number): Release {
  const where = `releases[${i}]`
  if (!isRecord(v)) fail(`${where} must be an object`)
  onlyKeys(v, RELEASE_KEYS, where)
  const status = v.status
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) fail(`${where}.status must be one of ${STATUSES.join(', ')}`)
  const r: Release = {
    version: str(v.version, `${where}.version`),
    status: status as ReleaseStatus,
    date: strOrNull(v.date, `${where}.date`),
    platform: str(v.platform, `${where}.platform`),
    requires: strList(v.requires, `${where}.requires`),
    bytes: v.bytes === null ? null : (typeof v.bytes === 'number' && Number.isInteger(v.bytes) && v.bytes > 0 ? v.bytes : fail(`${where}.bytes must be a positive integer or null`)),
    sha256: strOrNull(v.sha256, `${where}.sha256`),
    primaryUrl: strOrNull(v.primaryUrl, `${where}.primaryUrl`),
    mirrorUrl: strOrNull(v.mirrorUrl, `${where}.mirrorUrl`),
    contents: strList(v.contents, `${where}.contents`),
    notes: localized(v.notes, `${where}.notes`),
    knownIssues: localizedList(v.knownIssues, `${where}.knownIssues`),
    setup: setupFile(v.setup, where),
  }
  if (r.status === 'preparing' && r.setup !== null) fail(`${where}.setup must be null while status is preparing`)
  if (r.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) fail(`${where}.date must be YYYY-MM-DD`)
  if (r.sha256 !== null && !/^[0-9a-f]{64}$/.test(r.sha256)) fail(`${where}.sha256 must be 64 lowercase hex characters`)
  const facts = { date: r.date, bytes: r.bytes, sha256: r.sha256, primaryUrl: r.primaryUrl, mirrorUrl: r.mirrorUrl }
  if (r.status === 'preparing') {
    for (const [k, val] of Object.entries(facts)) if (val !== null) fail(`${where}.${k} must be null while status is preparing`)
  } else {
    // The mirror is optional: it is a GitHub Releases asset, and the repository is private.
    for (const [k, val] of Object.entries(facts)) if (val === null && k !== 'mirrorUrl') fail(`${where}.${k} is required when status is ${r.status}`)
    // The primary is an https URL, or a ZIP the site serves itself from /files/ (staged at deploy).
    if (!/^https:\/\//.test(r.primaryUrl ?? '') && !SITE_FILE.test(r.primaryUrl ?? '')) fail(`${where}.primaryUrl must be an https URL or /files/<name>.zip`)
    if (r.mirrorUrl !== null && !/^https:\/\//.test(r.mirrorUrl)) fail(`${where}.mirrorUrl must be an https URL or null`)
  }
  return r
}

export function parseReleases(input: unknown): ReleaseData {
  if (!isRecord(input)) fail('root must be an object')
  onlyKeys(input, TOP_KEYS, 'root')
  if (input.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (!Array.isArray(input.releases)) fail('releases must be a list')
  const list = input.releases.map(parseRelease)
  const seen = new Set<string>()
  for (const r of list) { if (seen.has(r.version)) fail(`duplicate version ${r.version}`); seen.add(r.version) }
  const recommended = strOrNull(input.recommended, 'recommended')
  if (recommended !== null && !seen.has(recommended)) fail(`recommended ${recommended} names no release`)
  const recommendedEntry = recommended !== null ? list.find(r => r.version === recommended) : undefined
  if (recommended !== null && recommendedEntry?.status === 'withdrawn') fail(`recommended ${recommended} is withdrawn`)
  if (recommended !== null && recommendedEntry?.status !== 'stable') fail(`recommended ${recommended} must be stable`)
  // Absent is treated as null: existing fixtures and callers that predate the beta channel need not carry the key.
  const beta = input.beta === undefined ? null : strOrNull(input.beta, 'beta')
  if (beta !== null && !seen.has(beta)) fail(`beta ${beta} names no release`)
  const betaEntry = beta !== null ? list.find(r => r.version === beta) : undefined
  if (beta !== null && betaEntry?.status !== 'beta') fail(`beta ${beta} must name a beta release`)
  if (beta !== null && recommended !== null && !isNewer(beta, recommended)) fail(`beta ${beta} must be newer than recommended ${recommended}`)
  return { schemaVersion: 1, recommended, beta, releases: list }
}

export function recommendedRelease(data: ReleaseData): Release | null {
  if (data.recommended === null) return null
  return data.releases.find(r => r.version === data.recommended) ?? null
}

export function betaRelease(data: ReleaseData): Release | null {
  if (data.beta === null) return null
  return data.releases.find(r => r.version === data.beta) ?? null
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export const releases: ReleaseData = parseReleases(raw)
