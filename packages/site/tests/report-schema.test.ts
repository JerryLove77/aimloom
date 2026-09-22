import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseReport } from '../src/worker/report-schema'

const valid = () => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'tests-worker', 'fixtures', 'report.valid.json'), 'utf8'))
const field = (v: unknown) => { const r = parseReport(v); return r.ok ? null : r.field }

describe('parseReport', () => {
  it('accepts the contract fixture unchanged', () => {
    const r = parseReport(valid()); expect(r.ok).toBe(true); if (r.ok) expect(r.report).toEqual(valid())
  })
  it('accepts an anonymous report with nothing optional', () => {
    expect(parseReport({ ...valid(), account: null, description: null, contact: null, log: null, system: { ...valid().system, powershell: null } }).ok).toBe(true)
  })
  it('refuses unknown keys at every level: the App sends exactly this and nothing else', () => {
    expect(field({ ...valid(), path: 'C:\\x' })).toBe('path')
    expect(field({ ...valid(), game: { found: true, root: 'D:\\x' } })).toBe('game.root')
    expect(field({ ...valid(), account: { ...valid().account, avatar: 'x' } })).toBe('account.avatar')
  })
  it('refuses prototype names as unknown keys, at every level: `in` would find them on Object.prototype', () => {
    const top = JSON.parse(JSON.stringify(valid()).replace('{', '{"__proto__":{"x":1},'))
    expect(Object.hasOwn(top, '__proto__')).toBe(true) // JSON.parse makes it an own property
    expect(field(top)).toBe('__proto__')
    const nested = JSON.parse(JSON.stringify(valid()).replace('"game":{', '"game":{"__proto__":{},'))
    expect(field(nested)).toBe('game.__proto__')
    expect(field({ ...valid(), constructor: 1 })).toBe('constructor')
    expect(field({ ...valid(), account: { ...valid().account, toString: 'x' } })).toBe('account.toString')
  })
  it('refuses a missing key', () => { const v = valid(); delete v.game; expect(field(v)).toBe('game') })
  it('holds the limits of the spec', () => {
    expect(field({ ...valid(), description: 'x'.repeat(2001) })).toBe('description')
    expect(field({ ...valid(), contact: 'x'.repeat(201) })).toBe('contact')
    expect(field({ ...valid(), log: '中'.repeat(174_763) })).toBe('log')            // 524,289 UTF-8 bytes
    expect(parseReport({ ...valid(), log: 'x'.repeat(512 * 1024) }).ok).toBe(true)
  })
  it('knows a SteamID is 17 digits and an account is never verified here', () => {
    expect(field({ ...valid(), account: { ...valid().account, steamId: '123' } })).toBe('account.steamId')
    expect(field({ ...valid(), account: { ...valid().account, verified: true } })).toBe('account.verified')
    expect(field({ ...valid(), account: { ...valid().account, name: 'n'.repeat(65) } })).toBe('account.name')
  })
  it('pins the shapes of the App fields', () => {
    expect(field({ ...valid(), app: { ...valid().app, label: 'v0.1.3' } })).toBe('app.label')
    expect(parseReport({ ...valid(), app: { ...valid().app, label: '0.1.3-test.2', commit: 'unknown' } }).ok).toBe(true)
    expect(field({ ...valid(), system: { ...valid().system, lang: 'fr' } })).toBe('system.lang')
    expect(field({ ...valid(), system: { ...valid().system, langChoice: 'auto' } })).toBe('system.langChoice')
    expect(field({ ...valid(), game: { found: 'yes' } })).toBe('game.found')
  })
  it('refuses what is not an object', () => { for (const v of [null, [], 'x', 1]) expect(field(v)).toBe('') })
})
