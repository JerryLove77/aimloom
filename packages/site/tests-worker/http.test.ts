import { describe, expect, it } from 'vitest'
import { fail, json, requireClient, requireContentLengthWithin, requireJsonContentType } from '../src/worker/http'

const req = (headers: Record<string, string> = {}) => new Request('https://aimloom.dev/api/reports', { method: 'POST', headers })

describe('shared HTTP guards (used by both /api/reports and /api/steam/resolve)', () => {
  it('json/fail answers carry nosniff alongside the existing no-store', () => {
    expect(json({ ok: true }).headers.get('x-content-type-options')).toBe('nosniff')
    expect(fail('NOT_FOUND', 404).headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('requireClient accepts only an Aimloom/x.y.z User-Agent, as a prefix', () => {
    expect(requireClient(req({ 'user-agent': 'Aimloom/0.1.3' }))).toBeNull()
    expect(requireClient(req({ 'user-agent': 'Aimloom/0.1.3-test.2' }))).toBeNull()
    expect(requireClient(req())?.status).toBe(400)
    expect(requireClient(req({ 'user-agent': 'curl/8' }))?.status).toBe(400)
  })
  it('requireJsonContentType accepts only application/json, case-insensitively', () => {
    expect(requireJsonContentType(req({ 'content-type': 'application/json' }))).toBeNull()
    expect(requireJsonContentType(req({ 'content-type': 'Application/JSON; charset=utf-8' }))).toBeNull()
    expect(requireJsonContentType(req())?.status).toBe(415)
    expect(requireJsonContentType(req({ 'content-type': 'text/plain' }))?.status).toBe(415)
  })
  it('requireContentLengthWithin refuses only when content-length is present and over the cap', () => {
    expect(requireContentLengthWithin(req(), 100)).toBeNull()
    expect(requireContentLengthWithin(req({ 'content-length': '100' }), 100)).toBeNull()
    expect(requireContentLengthWithin(req({ 'content-length': '101' }), 100)?.status).toBe(413)
  })
})
