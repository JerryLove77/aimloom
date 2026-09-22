import { describe, expect, it, vi } from 'vitest'
import worker, { limited } from '../src/worker/index'
import type { AppEnv } from '../src/worker/env'

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

describe('rate limits', () => {
  it('keys the limit by the client address and by nothing else', async () => {
    const keys: string[] = []; const limit = { limit: async (o: { key: string }) => { keys.push(o.key); return { success: true } } }
    expect(await limited(limit, new Request('https://aimloom.dev/api/reports', { headers: { 'cf-connecting-ip': '198.51.100.7' } }), true)).toBeNull()
    expect(await limited(limit, new Request('https://aimloom.dev/api/reports'), true)).toBeNull()
    expect(keys).toEqual(['198.51.100.7', 'unknown'])
  })
  it('answers 429 RATE_LIMITED before a report is even read', async () => {
    let read = false
    const env = { REPORT_LIMIT: { limit: async () => ({ success: false }) }, DB: { prepare() { read = true; throw new Error('must not be reached') } } } as unknown as AppEnv
    const request = new Request('https://aimloom.dev/api/reports', { method: 'POST', body: '{}' })
    const r = await worker.fetch(request, env, ctx)
    expect(r.status).toBe(429); expect(await r.json()).toEqual({ code: 'RATE_LIMITED' }); expect(read).toBe(false)
    expect(request.bodyUsed).toBe(false)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('lets a report through when the limiter itself fails, and says so without the address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { limit: async () => { throw new Error('binding down') } }
    expect(await limited(broken, new Request('https://aimloom.dev/api/reports', { headers: { 'cf-connecting-ip': '198.51.100.7' } }), true)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/rate limiter unavailable/)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('198.51.100.7')
    warn.mockRestore()
  })
  it('refuses when the limiter fails on a route that must fail closed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { limit: async () => { throw new Error('binding down') } }
    const r = await limited(broken, new Request('https://aimloom.dev/api/steam/resolve'), false)
    expect(r?.status).toBe(429); expect(await r?.json()).toEqual({ code: 'RATE_LIMITED' })
    warn.mockRestore()
  })
  it('fails closed on the Steam route: a broken limiter means nothing is fetched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('must not be reached') })
    const env = { STEAM_LIMIT: { limit: async () => { throw new Error('binding down') } } } as unknown as AppEnv
    const r = await worker.fetch(new Request('https://aimloom.dev/api/steam/resolve', { method: 'POST', body: JSON.stringify({ url: 'https://steamcommunity.com/id/x' }), headers: { 'content-type': 'application/json' } }), env, ctx)
    expect(r.status).toBe(429); expect(await r.json()).toEqual({ code: 'RATE_LIMITED' }); expect(fetched).not.toHaveBeenCalled()
    fetched.mockRestore(); warn.mockRestore()
  })
})
