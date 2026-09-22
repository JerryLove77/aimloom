import { describe, expect, it } from 'vitest'
import { handleSteamResolve } from '../src/worker/steam'

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://aimloom.dev/api/steam/resolve', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'user-agent': 'Aimloom/0.1.3', ...headers } })
const answers = (xml: string, status = 200): typeof fetch => async () => new Response(xml, { status })
const result = async (r: Promise<Response>) => { const x = await r; return [x.status, await x.json()] }

describe('POST /api/steam/resolve', () => {
  it('answers the id and the name', async () => {
    let asked = ''
    const fetcher: typeof fetch = async input => { asked = String(input); return new Response('<steamID64>76561198000000042</steamID64><steamID><![CDATA[PlayerOne]]></steamID>') }
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/jl7' }), fetcher))).toEqual([200, { steamId: '76561198000000042', name: 'PlayerOne' }])
    expect(asked).toBe('https://steamcommunity.com/id/jl7/?xml=1')
  })
  it('refuses a link it would not fetch, without fetching', async () => {
    let fetched = false
    expect(await result(handleSteamResolve(post({ url: 'https://evil.test/id/x' }), async () => { fetched = true; return new Response('') }))).toEqual([400, { code: 'INVALID_STEAM_URL' }])
    expect(await result(handleSteamResolve(post({ link: 'x' })))).toEqual([400, { code: 'INVALID_STEAM_URL' }])
    expect(fetched).toBe(false)
  })
  it('says not found, unreachable, or wrong method', async () => {
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/nobody' }), answers('<response><error><![CDATA[The specified profile could not be found.]]></error></response>')))).toEqual([404, { code: 'STEAM_NOT_FOUND' }])
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }), answers('busy', 503)))).toEqual([502, { code: 'STEAM_UNREACHABLE' }])
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }), async () => { throw new Error('network') }))).toEqual([502, { code: 'STEAM_UNREACHABLE' }])
    expect(await result(handleSteamResolve(new Request('https://aimloom.dev/api/steam/resolve')))).toEqual([405, { code: 'METHOD_NOT_ALLOWED' }])
  })
  it('never follows a redirect: a 3xx from Steam is "unreachable", and the fetch says redirect: manual', async () => {
    let seen: RequestInit | undefined
    const fetcher: typeof fetch = async (_input, init) => { seen = init; return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }) }
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }), fetcher))).toEqual([502, { code: 'STEAM_UNREACHABLE' }])
    expect(seen?.redirect).toBe('manual')
  })
  it('stops reading at 64 KiB: a huge answer is not downloaded', async () => {
    let pulled = 0
    const head = new TextEncoder().encode('<steamID64>76561198000000042</steamID64><steamID><![CDATA[PlayerOne]]></steamID>')
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { const chunk = pulled === 0 ? head : new Uint8Array(16 * 1024).fill(32); pulled += chunk.byteLength; if (pulled > 8 * 1024 * 1024) controller.close(); else controller.enqueue(chunk) },
    })
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }), async () => new Response(body)))).toEqual([200, { steamId: '76561198000000042', name: 'PlayerOne' }])
    expect(pulled).toBeLessThan(256 * 1024) // the cap is 64 KiB; a stream may run a few chunks ahead, never megabytes
  })
  it('requires the same App client and JSON type as the report route: this is a free Steam resolver otherwise', async () => {
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }, { 'user-agent': 'curl/8' })))).toEqual([400, { code: 'UNKNOWN_CLIENT' }])
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }, { 'content-type': 'text/plain' })))).toEqual([415, { code: 'UNSUPPORTED_MEDIA_TYPE' }])
  })
  it('rejects a body whose declared content-length already exceeds 4 KiB', async () => {
    const request = post({ url: 'https://steamcommunity.com/id/x' }, { 'content-length': String(8 * 1024) })
    expect(await result(handleSteamResolve(request))).toEqual([413, { code: 'TOO_LARGE' }])
  })
  it('answers INVALID_STEAM_URL, not a bare rejection, when the body read itself fails', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(8)); throw new Error('connection reset') } })
    const request = new Request('https://aimloom.dev/api/steam/resolve', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'user-agent': 'Aimloom/0.1.3' },
      // @ts-expect-error — see above
      duplex: 'half',
    })
    expect(await result(handleSteamResolve(request))).toEqual([400, { code: 'INVALID_STEAM_URL' }])
  })
  it('releases the stream even when reading fails part way: the abort path is the one that needs it', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(8 * 1024)); throw new Error('connection reset') },
      cancel() { cancelled = true },
    })
    const response = new Response(body)
    const originalGetReader = response.body!.getReader
    let readerCancelCalled = false
    response.body!.getReader = function(...args: any[]) {
      const reader = originalGetReader.apply(this, args)
      const originalCancel = reader.cancel.bind(reader)
      reader.cancel = async function() {
        readerCancelCalled = true
        return originalCancel()
      }
      return reader
    }
    expect(await result(handleSteamResolve(post({ url: 'https://steamcommunity.com/id/x' }), async () => response))).toEqual([502, { code: 'STEAM_UNREACHABLE' }])
    expect(readerCancelCalled).toBe(true)
  })
})
