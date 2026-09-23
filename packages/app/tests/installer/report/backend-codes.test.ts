// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The third seam between the App and its backend, after the paths (`backend-paths.test.ts`) and
 * the command shapes (`command-shapes.test.ts`): the failure codes. The Worker names every code
 * it can answer with in one union, `ErrorCode` in `packages/site/src/worker/http.ts`. Rust turns
 * a code into a sentence the player reads.
 *
 * A code Rust does not know still gets a sensible generic sentence, so an unmapped code is not a
 * bug by itself. What is a bug is an unmapped code nobody decided about: a new "your report is
 * too long" that reaches the player as "failed (status 413), try again later". So every code must
 * be either mapped or listed below with the reason it is allowed to fall back.
 */
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const http = readFileSync(root + 'packages/site/src/worker/http.ts', 'utf8')
const native = ['report.rs', 'commands.rs']
  .map(file => readFileSync(root + 'packages/app/src-tauri/src/installer/' + file, 'utf8').split(/\n#\[cfg\(test\)\]/)[0]!)
  .join('\n')

const union = /export type ErrorCode =([\s\S]*?)\n\n/.exec(http)?.[1] ?? ''
const emitted = [...union.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]!)
// A match arm may name several codes: `"DAILY_LIMIT" | "STORAGE_FULL" => …`.
const mapped = new Set([...native.matchAll(/^\s*((?:"[A-Z_]+"\s*\|?\s*)+)=>/gm)].flatMap(m => [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map(c => c[1]!)))

/** Codes that reach the generic sentence on purpose. Each needs its reason. */
const FALLS_BACK_ON_PURPOSE: Record<string, string> = {
  NOT_FOUND: 'only a wrong path produces it, and backend-paths.test.ts pins the paths',
  METHOD_NOT_ALLOWED: 'the App only ever POSTs to these routes; a player cannot cause it',
  UNSUPPORTED_MEDIA_TYPE: 'the HTTP client always sends application/json; a player cannot cause it',
  INVALID_JSON: 'the payload is serialised natively, never typed; a player cannot cause it',
  STORAGE_FAILED: 'a transient server fault — "try again later" is exactly the right advice',
  FORBIDDEN: 'only the site\'s sign-in and upload routes answer it (Origin check); the App never calls them',
  UNAUTHORIZED: 'only the site\'s upload routes answer it (no session); the App never calls them',
}

describe('every failure the backend can answer with is accounted for in the App', () => {
  it('the scan really found the Worker\'s union and Rust\'s match arms (canary)', () => {
    // A guard that can pass on an empty scan is not a guard — this repository has had one.
    expect(emitted.length).toBeGreaterThanOrEqual(10)
    expect(mapped.size).toBeGreaterThanOrEqual(9)
    expect(emitted).toContain('RATE_LIMITED')
    expect(mapped).toContain('RATE_LIMITED')
  })

  it('each code is mapped to a sentence, or falls back for a stated reason', () => {
    const undecided = emitted.filter(code => !mapped.has(code) && !(code in FALLS_BACK_ON_PURPOSE))
    expect(undecided, 'these codes reach the player as a bare status number and nobody decided that').toEqual([])
  })

  it('no exemption outlives its reason', () => {
    // An exemption for a code the Worker no longer has, or one Rust has since mapped, is dead
    // weight that would silently excuse the next code to reuse the name.
    const stale = Object.keys(FALLS_BACK_ON_PURPOSE).filter(code => !emitted.includes(code) || mapped.has(code))
    expect(stale).toEqual([])
  })

  it('Rust maps no code the Worker cannot send', () => {
    const invented = [...mapped].filter(code => !emitted.includes(code))
    expect(invented).toEqual([])
  })
})
