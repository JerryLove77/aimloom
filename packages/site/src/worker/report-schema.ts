export interface Report {
  app: { label: string; commit: string; built: string }
  system: { windows: string; displayLanguage: string; langChoice: 'system' | 'zh' | 'en'; lang: 'zh' | 'en'; powershell: string | null }
  game: { found: boolean }
  account: { steamId: string; name: string; verified: false } | null
  description: string | null
  contact: string | null
  log: string | null
}
export type Parsed = { ok: true; report: Report } | { ok: false; field: string }

export const MAX_DESCRIPTION = 2000, MAX_CONTACT = 200, MAX_LOG_BYTES = 512 * 1024, MAX_NAME = 64
const bytes = (s: string) => new TextEncoder().encode(s).length
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type Check = (v: unknown) => boolean
const text = (max: number, pattern?: RegExp): Check => v => typeof v === 'string' && v.length > 0 && v.length <= max && (!pattern || pattern.test(v))
const nullable = (check: Check): Check => v => v === null || check(v)
const oneOf = (...values: string[]): Check => v => typeof v === 'string' && values.includes(v)

/** Every key must be present and no other key may be: the first offender's path is returned. */
function shape(value: unknown, path: string, checks: Record<string, Check>): string | null {
  if (!isRecord(value)) return path
  for (const key of Object.keys(value)) if (!Object.hasOwn(checks, key)) return path ? `${path}.${key}` : key
  for (const [key, check] of Object.entries(checks)) if (!Object.hasOwn(value, key) || !check(value[key])) return path ? `${path}.${key}` : key
  return null
}

export function parseReport(value: unknown): Parsed {
  if (!isRecord(value)) return { ok: false, field: '' }
  let nested: string | null = null
  const sub = (path: string, checks: Record<string, Check>): Check => v => { const bad = shape(v, path, checks); if (bad !== null && nested === null) nested = bad; return bad === null }
  const top = shape(value, '', {
    app: sub('app', { label: text(40, /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/), commit: text(40, /^([0-9a-f]{7,40}|unknown)$/), built: text(40) }),
    system: sub('system', { windows: text(40), displayLanguage: text(20), langChoice: oneOf('system', 'zh', 'en'), lang: oneOf('zh', 'en'), powershell: nullable(text(40)) }),
    game: sub('game', { found: v => typeof v === 'boolean' }),
    account: nullable(sub('account', { steamId: text(17, /^\d{17}$/), name: text(MAX_NAME), verified: v => v === false })),
    description: nullable(text(MAX_DESCRIPTION)),
    contact: nullable(text(MAX_CONTACT)),
    log: nullable(v => typeof v === 'string' && v.length > 0 && bytes(v) <= MAX_LOG_BYTES),
  })
  if (top !== null) return { ok: false, field: nested ?? top }
  return { ok: true, report: value as unknown as Report }
}
