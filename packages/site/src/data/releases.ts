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
export interface ReleaseData { schemaVersion: 1; recommended: string | null; releases: Release[] }

const STATUSES: readonly ReleaseStatus[] = ['preparing', 'beta', 'stable', 'withdrawn']
const RELEASE_KEYS = ['version', 'status', 'date', 'platform', 'requires', 'bytes', 'sha256', 'primaryUrl', 'mirrorUrl', 'contents', 'notes', 'knownIssues', 'setup'] as const
const TOP_KEYS = ['schemaVersion', 'recommended', 'releases'] as const
/** A release ZIP served by the site itself; scripts/stage-release.mjs copies it into dist/files/. */
export const SITE_FILE = /^\/files\/[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/
/** A Windows Setup served by the site itself, beside the ZIP; staged and checked the same way. */
export const SITE_SETUP = /^\/files\/[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/

function fail(message: string): never { throw new Error(`releases.json: ${message}`) }
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
  if (!SITE_SETUP.test(url)) fail(`${where}.setup.url must be /files/<name>.exe`)
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
  if (recommended !== null && list.find(r => r.version === recommended)?.status === 'withdrawn') fail(`recommended ${recommended} is withdrawn`)
  return { schemaVersion: 1, recommended, releases: list }
}

export function recommendedRelease(data: ReleaseData): Release | null {
  if (data.recommended === null) return null
  return data.releases.find(r => r.version === data.recommended) ?? null
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export const releases: ReleaseData = parseReleases(raw)
