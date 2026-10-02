import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { encodePng } from '@kvk/crosshair'
import { createSession, handleAuth, readSession, safeNext } from '../src/worker/auth'
import { handleExplore } from '../src/worker/explore'
import type { AppEnv } from '../src/worker/env'
import { seedItems } from './seed'

// The fixed fake identities (CLAUDE.md): an admin, a creator and a creator the admin trusts.
const ADMIN = '76561198000000042', CREATOR = '76561198000000043', TRUSTED = '76561198000000044'
const base = testEnv as unknown as Pick<AppEnv, 'DB' | 'FILES' | 'UPLOADS'>
const NOW = new Date('2026-10-20T12:00:00Z')
const shellHtml = `<!doctype html><html><head><title>Explore · Aimloom</title><meta name="description" content="shell" /></head><body><div id="explore-root"></div></body></html>`
const assets = { fetch: async (req: Request) => (/^\/(zh|en)\/explore\/(item-shell|upload|mine|review|welcome)?\/?$/.test(new URL(req.url).pathname) ? new Response(shellHtml, { headers: { 'content-type': 'text/html' } }) : new Response('the 404 page', { status: 404 })) }
const env = { ...base, ASSETS: assets, FILES_ORIGIN: 'https://dl.test.invalid', ADMIN_STEAM_IDS: ` ${ADMIN} `, TURNSTILE_SITE_KEY: 'test-site-key', TURNSTILE_SECRET: 'test-secret' } as unknown as AppEnv
// Cloudflare's siteverify, faked: the token "human" passes, anything else fails. Records what it was sent.
const siteverify: string[] = []
const fetcher = (async (input: string, init?: RequestInit) => {
  if (input !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') throw new Error(`unexpected fetch ${input}`)
  const body = String(init?.body); siteverify.push(body)
  return Response.json({ success: new URLSearchParams(body).get('response') === 'human' })
}) as typeof fetch
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const ORIGIN = 'https://aimloom.dev'
const png = () => { const d = new Uint8Array(16 * 16 * 4); for (let i = 0; i < 16; i++) d.set([0, 255, 102, 255], (i * 16 + 8) * 4); return encodePng({ width: 16, height: 16, data: d, warnings: [] }) }

/** A signed-in creator who has already picked a display name (the first sign-in's step), unless `named` is false. */
async function cookieFor(steamId: string, named = true): Promise<string> {
  if (named) await base.DB.prepare("INSERT OR IGNORE INTO creator (steam_id, trusted, display_name, author_url, first_seen) VALUES (?, 0, 'Sample author', 'https://example.com/a', '2026-10-01T00:00:00Z')").bind(steamId).run()
  return `aimloom_session=${await createSession(env, steamId, NOW)}`
}
const send = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers); if (init.cookie) headers.set('cookie', init.cookie)
  return handleExplore(new Request(ORIGIN + path, { ...init, headers, redirect: 'manual' }), env, ctx, NOW, fetcher)
}
function form(fields: Record<string, string>, file: { name: string; bytes: Uint8Array; type: string } | null = { name: 'small dot.png', bytes: png(), type: 'image/png' }): FormData {
  const fd = new FormData()
  if (file) fd.set('cf-turnstile-response', 'human')
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('file', new File([file.bytes as BlobPart], file.name, { type: file.type }))
  return fd
}
const VALID = { kind: 'crosshair', title_zh: '小点', title_en: 'Small dot', summary_zh: '绿色小点', summary_en: 'A green dot', licence: 'CC-BY-4.0', code: '', confirm: 'yes' }
const post = (path: string, fd: FormData, cookie: string, origin: string | null = ORIGIN) => send(path, { method: 'POST', body: fd, cookie, headers: origin ? { origin } : {} })
const item = (slug: string) => base.DB.prepare('SELECT * FROM item WHERE slug = ?').bind(slug).first<Record<string, unknown>>()
/** Where an item's file is kept now; a waiting file's key has a random part. */
const keyOf = async (slug: string) => String((await item(slug))!.file_key)

describe('review page navigation', () => {
  it('keeps the two list positions through forms, errors and successful actions', async () => {
    await seedItems(...Array.from({length: 53},(_,i)=>({slug:`pending-${String(i).padStart(2,'0')}`,status:'pending' as const})),
      ...Array.from({length: 30},(_,i)=>({slug:`live-${String(i).padStart(2,'0')}`})))
    const admin = await cookieFor(ADMIN)
    const first = (await send('/en/explore/review/',{cookie:admin}))!
    const html = await first.text()
    const next = (kind: string) => {
      const nav = html.match(new RegExp(`<nav[^>]*data-review-page="${kind}"[^>]*>([\\s\\S]*?)</nav>`))
      expect(nav).not.toBeNull()
      const link = nav![1]!.match(/rel="next" href="([^"]+)"/)
      expect(link).not.toBeNull()
      return new URL(link![1]!.replaceAll('&amp;','&'),ORIGIN)
    }
    const second = next('pending'); second.searchParams.set('live_after',next('live').searchParams.get('live_after')!)
    const page = await (await send(second.pathname+second.search,{cookie:admin}))!.text()
    expect(page).toContain('Title pending-24'); expect(page).not.toContain('Title pending-00')
    expect(page).toContain('Title live-05'); expect(page).not.toContain('Title live-29')
    expect(page).toContain('action="'+second.pathname+'action'+second.search.replaceAll('&','&amp;')+'"')
    const endpoint = second.pathname+'action'+second.search
    const error = await (await post(endpoint,form({slug:'pending-24',action:'reject'},null),admin))!.text()
    expect(error).toContain('A rejection needs a reason.'); expect(error).toContain('Title pending-24')
    expect(error).not.toContain('Title pending-00')
    const done = (await post(endpoint,form({slug:'pending-24',action:'reject',reason:'Synthetic rejection'},null),admin))!
    expect(done.status).toBe(303); expect(done.headers.get('location')).toBe(second.toString())
    const updated = await (await send(second.pathname+second.search,{cookie:admin}))!.text()
    expect(updated).not.toContain('Title pending-24'); expect(updated).toContain('Title pending-25')
  })
})

describe('sign in through Steam', () => {
  it('sends the browser to Steam with the callback and the page to return to', async () => {
    const r = (await handleAuth(new Request(`${ORIGIN}/auth/steam/login?next=/en/explore/upload/`), env, NOW))!
    expect(r.status).toBe(302)
    const to = new URL(r.headers.get('location')!)
    expect(to.origin + to.pathname).toBe('https://steamcommunity.com/openid/login')
    expect(to.searchParams.get('openid.return_to')).toBe(`${ORIGIN}/auth/steam/callback?next=%2Fen%2Fexplore%2Fupload%2F`)
    expect(to.searchParams.get('openid.realm')).toBe(ORIGIN)
  })
  it('only ever returns to a page on this site', () => {
    expect(safeNext('/en/explore/?kind=sound')).toBe('/en/explore/?kind=sound')
    for (const bad of ['https://evil.example/', '//evil.example', '/api/reports', null]) expect(safeNext(bad)).toBe('/zh/explore/')
  })
  it('creates a session only after Steam confirms the signed answer, and signs out on POST from this origin', async () => {
    const cb = (id: string) => `${ORIGIN}/auth/steam/callback?next=/en/explore/&openid.mode=id_res&openid.claimed_id=https://steamcommunity.com/openid/id/${id}&openid.return_to=${encodeURIComponent(`${ORIGIN}/auth/steam/callback?next=/en/explore/`)}&openid.sig=x`
    const said = (text: string) => async () => new Response(text)
    const bad = (await handleAuth(new Request(cb(CREATOR)), env, NOW, said('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n')))!
    expect(bad.status).toBe(302); expect(bad.headers.get('location')).toBe(`${ORIGIN}/en/explore/?signin=failed`); expect(bad.headers.get('set-cookie')).toBeNull()
    const ok = (await handleAuth(new Request(cb(CREATOR)), env, NOW, said('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n')))!
    // A first sign-in picks a display name before going on; a known creator goes straight on.
    expect(ok.status).toBe(302); expect(ok.headers.get('location')).toBe(`${ORIGIN}/en/explore/welcome/?next=%2Fen%2Fexplore%2F`)
    await base.DB.prepare("INSERT INTO creator (steam_id, trusted, display_name, first_seen) VALUES (?, 0, 'Sample author', '2026-10-01T00:00:00Z')").bind(CREATOR).run()
    const again = (await handleAuth(new Request(cb(CREATOR)), env, NOW, said('is_valid:true\n')))!
    expect(again.headers.get('location')).toBe(`${ORIGIN}/en/explore/`)
    const cookie = ok.headers.get('set-cookie')!
    expect(cookie).toMatch(/^aimloom_session=[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/)
    const token = cookie.slice('aimloom_session='.length, 'aimloom_session='.length + 64)
    expect(await readSession(new Request(ORIGIN, { headers: { cookie: `aimloom_session=${token}` } }), env, NOW)).toEqual({ steamId: CREATOR })
    // Only the hash is stored.
    expect(await base.DB.prepare('SELECT token_hash FROM session').first<string>('token_hash')).not.toBe(token)
    const noOrigin = (await handleAuth(new Request(`${ORIGIN}/auth/signout`, { method: 'POST', headers: { cookie: `aimloom_session=${token}` } }), env, NOW))!
    expect(noOrigin.status).toBe(403)
    const out = (await handleAuth(new Request(`${ORIGIN}/auth/signout?next=/en/explore/`, { method: 'POST', headers: { cookie: `aimloom_session=${token}`, origin: ORIGIN } }), env, NOW))!
    expect(out.status).toBe(303); expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await readSession(new Request(ORIGIN, { headers: { cookie: `aimloom_session=${token}` } }), env, NOW)).toBeNull()
  })
  it('an unknown or forged cookie is nobody', async () => {
    expect(await readSession(new Request(ORIGIN, { headers: { cookie: `aimloom_session=${'f'.repeat(64)}` } }), env, NOW)).toBeNull()
    const html = await (await send('/en/explore/'))!.text()
    expect(html).toContain('Sign in through Steam'); expect(html).not.toContain('My uploads')
  })
})

describe('the upload page', () => {
  it('asks a visitor to sign in, and refuses a POST without a session or from another origin', async () => {
    const html = await (await send('/en/explore/upload/'))!.text()
    expect(html).toContain('Sign in through Steam first'); expect(html).not.toContain('<form')
    expect((await post('/en/explore/upload/', form(VALID), ''))!.status).toBe(401)
    expect((await post('/en/explore/upload/', form(VALID), await cookieFor(CREATOR), 'https://evil.example'))!.status).toBe(403)
    expect((await post('/en/explore/upload/', form(VALID), await cookieFor(CREATOR), null))!.status).toBe(403)
  })
  it('shows the signed-in creator the form, with their links, and keeps the page out of shared caches', async () => {
    const r = (await send('/zh/explore/upload/', { cookie: await cookieFor(CREATOR) }))!
    const html = await r.text()
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(html).toContain('已通过 Steam 登录'); expect(html).toContain('href="/zh/explore/mine/"'); expect(html).not.toContain('href="/zh/explore/review/"')
    expect(html).toContain('enctype="multipart/form-data"'); expect(html).toContain('name="confirm"'); expect(html).not.toContain('name="author"')
  })
  it('sends a creator without a display name to pick one first, and remembers it for their uploads', async () => {
    const cookie = await cookieFor(CREATOR, false)
    const r = (await send('/en/explore/upload/', { cookie }))!
    expect(r.status).toBe(302); expect(r.headers.get('location')).toBe(`${ORIGIN}/en/explore/welcome/?next=%2Fen%2Fexplore%2Fupload%2F`)
    expect(await (await send('/en/explore/welcome/', { cookie }))!.text()).toContain('name="author"')
    const bad = await (await post('/en/explore/welcome/', form({ author: '', author_url: 'http://x' }, null), cookie))!.text()
    expect(bad).toContain('Give a display name'); expect(bad).toContain('must start with https://')
    const ok = (await post('/en/explore/welcome/', form({ author: 'Chosen name', author_url: 'https://example.com/me', next: '/en/explore/upload/' }, null), cookie))!
    expect(ok.status).toBe(303); expect(ok.headers.get('location')).toBe(`${ORIGIN}/en/explore/upload/`)
    await post('/en/explore/upload/', form(VALID), cookie)
    expect(await item('small-dot')).toMatchObject({ author: 'Chosen name', author_url: 'https://example.com/me' })
    expect(await (await send('/en/explore/mine/', { cookie }))!.text()).toContain('Name: Chosen name')
  })
  it('escapes the display name wherever the account bar shows it', async () => {
    const cookie = await cookieFor(CREATOR, false)
    await post('/en/explore/welcome/', form({ author: '<img src=x onerror=alert(1)>', next: '/en/explore/' }, null), cookie)
    const html = await (await send('/en/explore/', { cookie }))!.text()
    expect(html).not.toContain('<img src=x'); expect(html).toContain('Name: &lt;img src=x onerror=alert(1)&gt;')
  })
  it('shows the human check on the form, refuses an upload that fails it, and sends Cloudflare no IP', async () => {
    const cookie = await cookieFor(CREATOR)
    const html = await (await send('/en/explore/upload/', { cookie }))!.text()
    expect(html).toContain('<div class="cf-turnstile" data-sitekey="test-site-key"'); expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js')
    const bot = form(VALID); bot.set('cf-turnstile-response', 'robot')
    expect(await (await post('/en/explore/upload/', bot, cookie))!.text()).toContain('The human check did not pass')
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM item').first<number>('c')).toBe(0)
    const sent = new URLSearchParams(siteverify.at(-1)!)
    expect([...sent.keys()].sort()).toEqual(['response', 'secret'])
  })
  it('keeps uploads closed while the Turnstile keys are missing', async () => {
    const closed = { ...env, TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET: undefined } as unknown as AppEnv
    const cookie = await cookieFor(CREATOR)
    const get = await handleExplore(new Request(`${ORIGIN}/en/explore/upload/`, { headers: { cookie } }), closed, ctx, NOW, fetcher)
    expect(await get!.text()).toContain('Uploads are not open yet')
    const put = await handleExplore(new Request(`${ORIGIN}/en/explore/upload/`, { method: 'POST', body: form(VALID), headers: { cookie, origin: ORIGIN } }), closed, ctx, NOW, fetcher)
    expect(put!.status).toBe(403)
  })
  it('names what is missing instead of uploading', async () => {
    const cookie = await cookieFor(CREATOR)
    const html = await (await post('/en/explore/upload/', form({ ...VALID, confirm: '' }), cookie))!.text()
    expect(html).toContain('Confirm that you have the right')
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM item').first<number>('c')).toBe(0)
    const noFile = await (await post('/en/explore/upload/', form(VALID, null), cookie))!.text()
    expect(noFile).toContain('Choose a file.')
    const notPng = await (await post('/en/explore/upload/', form(VALID, { name: 'x.png', bytes: new Uint8Array(100), type: 'image/png' }), cookie))!.text()
    expect(notPng).toContain('The upload did not go through')
  })
  it('needs only the file and the agreement: kind and name come from the file, the credit from the account', async () => {
    const html = await (await post('/zh/explore/upload/', form({ confirm: 'yes', licence: 'CC-BY-4.0' }, { name: 'small dot.png', bytes: png(), type: 'image/png' }), await cookieFor(CREATOR)))!.text()
    expect(html).toContain('收到了')
    expect(await item('small-dot')).toMatchObject({ kind: 'crosshair', title_zh: 'small dot', title_en: 'small dot', summary_zh: '', summary_en: '', author: 'Sample author' })
  })
  it('puts a new creator\'s file in the private bucket as pending, invisible to the public', async () => {
    const r = (await post('/en/explore/upload/', form(VALID), await cookieFor(CREATOR)))!
    const html = await r.text()
    expect(r.status).toBe(200); expect(html).toContain('It will appear on Explore once approved')
    const row = (await item('small-dot'))!
    expect(row).toMatchObject({ status: 'pending', source: 'upload', uploader: CREATOR, author: 'Sample author', kind: 'crosshair' })
    expect(String(row.file_key)).toMatch(/^pending\/small-dot\/[0-9a-f]{16}\/small dot\.png$/)
    expect(await base.UPLOADS.get(String(row.file_key))).not.toBeNull()
    expect((await base.FILES.list()).objects).toHaveLength(0)
    expect(await (await send('/en/explore/?kind=crosshair'))!.text()).not.toContain('Small dot')
    expect((await send('/en/explore/small-dot/'))!.status).toBe(404)
    expect((await send('/d/small-dot'))!.status).toBe(404)
  })
  it('publishes a trusted creator\'s file at once, to the public bucket', async () => {
    await base.DB.prepare("INSERT INTO creator (steam_id, trusted, display_name, first_seen) VALUES (?, 1, 'Trusted one', '2026-10-01T00:00:00Z')").bind(TRUSTED).run()
    const html = await (await post('/zh/explore/upload/', form({ ...VALID, title_en: '' }), await cookieFor(TRUSTED)))!.text()
    expect(html).toContain('已上线：'); expect(html).toContain('href="/zh/explore/small-dot/"')
    const row = (await item('small-dot'))!
    expect(row.status).toBe('published'); expect(row.title_en).toBe('小点')
    expect(String(row.file_key)).toMatch(/^files\/[0-9a-f]{64}\/small dot\.png$/)
    expect(await base.FILES.get(String(row.file_key))).not.toBeNull()
    expect(await (await send('/zh/explore/?kind=crosshair'))!.text()).toContain('小点')
  })
  it('refuses a file name already on Explore, and more than ten uploads in a day', async () => {
    const cookie = await cookieFor(CREATOR)
    await post('/en/explore/upload/', form(VALID), cookie)
    expect(await (await post('/en/explore/upload/', form(VALID), cookie))!.text()).toContain('already on Explore')
    for (let i = 0; i < 9; i++) await post('/en/explore/upload/', form(VALID, { name: `dot ${i}.png`, bytes: png(), type: 'image/png' }), cookie)
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM item WHERE uploader = ?').bind(CREATOR).first<number>('c')).toBe(10)
    expect(await (await post('/en/explore/upload/', form(VALID, { name: 'one more.png', bytes: png(), type: 'image/png' }), cookie))!.text()).toContain('You have uploaded 10 today')
  })
})

describe('my uploads', () => {
  it('lists the creator\'s own uploads with their status, and withdraws one on request', async () => {
    const cookie = await cookieFor(CREATOR)
    await post('/en/explore/upload/', form(VALID), cookie)
    expect((await send('/en/explore/mine/'))!.status).toBe(302)
    const html = await (await send('/en/explore/mine/', { cookie }))!.text()
    expect(html).toContain('Small dot'); expect(html).toContain('Awaiting review'); expect(html).toContain('name="slug" value="small-dot"')
    const pending = await keyOf('small-dot')
    const other = await cookieFor(TRUSTED)
    await post('/en/explore/mine/withdraw', form({ slug: 'small-dot' }, null), other)
    expect((await item('small-dot'))!.status).toBe('pending')
    const r = (await post('/en/explore/mine/withdraw', form({ slug: 'small-dot' }, null), cookie))!
    expect(r.status).toBe(303)
    expect((await item('small-dot'))!.status).toBe('withdrawn')
    expect(await base.UPLOADS.get(pending)).toBeNull()
  })
})

describe('the review page', () => {
  it('is a 404 for everyone but an admin, files included', async () => {
    await post('/en/explore/upload/', form(VALID), await cookieFor(CREATOR))
    expect((await send('/en/explore/review/'))!.status).toBe(404)
    expect((await send('/en/explore/review/', { cookie: await cookieFor(CREATOR) }))!.status).toBe(404)
    expect((await send('/en/explore/review/file/small-dot', { cookie: await cookieFor(CREATOR) }))!.status).toBe(404)
  })
  it('shows the admin the queue with the pending file, and approves it into the public bucket', async () => {
    await post('/en/explore/upload/', form(VALID), await cookieFor(CREATOR))
    const admin = await cookieFor(ADMIN)
    const html = await (await send('/en/explore/review/', { cookie: admin }))!.text()
    expect(html).toContain('小点 / Small dot'); expect(html).toContain(`Uploader SteamID ${CREATOR}`); expect(html).toContain('src="/en/explore/review/file/small-dot"')
    const file = (await send('/en/explore/review/file/small-dot', { cookie: admin }))!
    expect(file.status).toBe(200); expect(file.headers.get('content-type')).toBe('image/png'); expect(file.headers.get('cache-control')).toBe('private, no-store')
    const pending = await keyOf('small-dot')
    expect(await base.UPLOADS.get(pending)).not.toBeNull()
    const r = (await post('/en/explore/review/action', form({ slug: 'small-dot', action: 'approve' }, null), admin))!
    expect(r.status).toBe(303)
    const row = (await item('small-dot'))!
    expect(row.status).toBe('published'); expect(String(row.file_key)).toMatch(/^files\//); expect(row.published_at).toBe(NOW.toISOString())
    expect(await base.FILES.get(String(row.file_key))).not.toBeNull(); expect(await base.UPLOADS.get(pending)).toBeNull()
    expect(await (await send('/en/explore/?kind=crosshair'))!.text()).toContain('Small dot')
  })
  it('rejects only with a reason the creator then sees, trusts a creator, and hides a live item', async () => {
    const creator = await cookieFor(CREATOR); const admin = await cookieFor(ADMIN)
    await post('/en/explore/upload/', form(VALID), creator)
    const pending = await keyOf('small-dot')
    const noReason = await (await post('/en/explore/review/action', form({ slug: 'small-dot', action: 'reject' }, null), admin))!.text()
    expect(noReason).toContain('A rejection needs a reason.'); expect((await item('small-dot'))!.status).toBe('pending')
    await post('/en/explore/review/action', form({ slug: 'small-dot', action: 'reject', reason: 'Too similar to an existing one' }, null), admin)
    expect((await item('small-dot'))!).toMatchObject({ status: 'rejected', reject_reason: 'Too similar to an existing one' })
    expect(await base.UPLOADS.get(pending)).toBeNull()
    expect(await (await send('/en/explore/mine/', { cookie: creator }))!.text()).toContain('Too similar to an existing one')
    await post('/en/explore/review/action', form({ slug: 'small-dot', action: 'trust' }, null), admin)
    expect(await base.DB.prepare('SELECT trusted FROM creator WHERE steam_id = ?').bind(CREATOR).first<number>('trusted')).toBe(1)
    const live = await (await post('/en/explore/upload/', form(VALID, { name: 'second.png', bytes: png(), type: 'image/png' }), creator))!.text()
    expect(live).toContain('Live:')
    await post('/en/explore/review/action', form({ slug: 'second', action: 'hide' }, null), admin)
    expect((await item('second'))!.status).toBe('hidden')
    expect((await send('/en/explore/second/'))!.status).toBe(404)
  })
})

// The same requests as above, sent at the same time: whatever order they land in, the database's
// rules leave one consistent outcome and no stray file.
describe('racing requests', () => {
  const objects = async (bucket: R2Bucket, prefix: string) => (await bucket.list({ prefix })).objects.length
  const log = () => base.DB.prepare('SELECT actor, action, slug, from_status, to_status FROM moderation_log ORDER BY id').all().then(r => r.results)

  it('lets one of two same-name uploads in, and keeps no file for the other', async () => {
    const before = await objects(base.UPLOADS, 'pending/')
    const cookies = [await cookieFor(CREATOR), await cookieFor(TRUSTED)]
    const pages = await Promise.all(cookies.map(c => post('/en/explore/upload/', form(VALID), c).then(r => r!.text())))
    expect(pages.filter(h => h.includes('already on Explore'))).toHaveLength(1)
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM item').first<number>('c')).toBe(1)
    expect(await objects(base.UPLOADS, 'pending/') - before).toBe(1)
  })
  it('keeps the daily limit when eleven uploads arrive at once', async () => {
    const before = await objects(base.UPLOADS, 'pending/')
    const cookie = await cookieFor(CREATOR)
    const pages = await Promise.all(Array.from({ length: 11 }, (_, i) => post('/en/explore/upload/', form(VALID, { name: `dot ${i}.png`, bytes: png(), type: 'image/png' }), cookie).then(r => r!.text())))
    expect(pages.filter(h => h.includes('You have uploaded 10 today'))).toHaveLength(1)
    expect(await base.DB.prepare('SELECT COUNT(*) AS c FROM item WHERE uploader = ?').bind(CREATOR).first<number>('c')).toBe(10)
    expect(await objects(base.UPLOADS, 'pending/') - before).toBe(10)
  })
  it('leaves no public file behind for a trusted creator\'s upload over the limit', async () => {
    await base.DB.prepare("INSERT INTO creator (steam_id, trusted, display_name, first_seen) VALUES (?, 1, 'Trusted one', '2026-10-01T00:00:00.000Z')").bind(TRUSTED).run()
    const cookie = await cookieFor(TRUSTED)
    await Promise.all(Array.from({ length: 11 }, (_, i) => post('/en/explore/upload/', form(VALID, { name: `dot ${i}.png`, bytes: png(), type: 'image/png' }), cookie)))
    expect(await base.DB.prepare("SELECT COUNT(*) AS c FROM item WHERE status = 'published'").first<number>('c')).toBe(10)
    expect(await objects(base.FILES, 'files/')).toBe(10)
  })
  it('lets one of two racing review decisions win, logs only it, and leaves nothing public for a rejected file', async () => {
    await post('/en/explore/upload/', form(VALID), await cookieFor(CREATOR))
    const pending = await keyOf('small-dot'); const admin = await cookieFor(ADMIN)
    const publicBefore = await objects(base.FILES, 'files/')
    const answers = await Promise.all([
      post('/en/explore/review/action', form({ slug: 'small-dot', action: 'approve' }, null), admin),
      post('/en/explore/review/action', form({ slug: 'small-dot', action: 'reject', reason: 'Too similar' }, null), admin),
    ])
    const status = String((await item('small-dot'))!.status)
    expect(['published', 'rejected']).toContain(status)
    expect(await log()).toEqual([expect.objectContaining({ slug: 'small-dot', from_status: 'pending', to_status: status })])
    expect(await objects(base.FILES, 'files/') - publicBefore).toBe(status === 'published' ? 1 : 0)
    expect(await base.UPLOADS.get(pending)).toBeNull()
    // The loser either saw the item already decided (a plain redirect) or lost the write and says so.
    for (const a of answers) if (a!.status === 200) expect(await a!.text()).toContain('Someone else acted on this item first')
  })
  it('an owner withdrawing while an admin approves: one wins, and nothing is left behind', async () => {
    const creator = await cookieFor(CREATOR)
    await post('/en/explore/upload/', form(VALID), creator)
    const pending = await keyOf('small-dot'); const publicBefore = await objects(base.FILES, 'files/')
    await Promise.all([
      post('/en/explore/review/action', form({ slug: 'small-dot', action: 'approve' }, null), await cookieFor(ADMIN)),
      post('/en/explore/mine/withdraw', form({ slug: 'small-dot' }, null), creator),
    ])
    const status = String((await item('small-dot'))!.status)
    expect(['published', 'withdrawn']).toContain(status)
    expect(await log()).toHaveLength(1)
    expect(await objects(base.FILES, 'files/') - publicBefore).toBe(status === 'published' ? 1 : 0)
    expect(await base.UPLOADS.get(pending)).toBeNull()
  })
})

describe('the moderation log', () => {
  it('records every decision and withdrawal with who made it, and a trust only when it changes', async () => {
    const creator = await cookieFor(CREATOR); const admin = await cookieFor(ADMIN)
    for (const name of ['a.png', 'b.png', 'c.png']) await post('/en/explore/upload/', form(VALID, { name, bytes: png(), type: 'image/png' }), creator)
    const act = (fields: Record<string, string>) => post('/en/explore/review/action', form(fields, null), admin)
    await act({ slug: 'a', action: 'approve' })
    await act({ slug: 'b', action: 'reject', reason: 'Too similar' })
    await post('/en/explore/mine/withdraw', form({ slug: 'c' }, null), creator)
    await act({ slug: 'a', action: 'hide' })
    await act({ slug: 'a', action: 'hide' }) // already hidden: nothing to log
    await act({ steam_id: CREATOR, action: 'trust' }); await act({ steam_id: CREATOR, action: 'trust' }); await act({ steam_id: CREATOR, action: 'untrust' })
    const rows = (await base.DB.prepare('SELECT actor, action, slug, creator, from_status, to_status, reason FROM moderation_log ORDER BY id').all()).results
    expect(rows).toEqual([
      { actor: ADMIN, action: 'approve', slug: 'a', creator: null, from_status: 'pending', to_status: 'published', reason: null },
      { actor: ADMIN, action: 'reject', slug: 'b', creator: null, from_status: 'pending', to_status: 'rejected', reason: 'Too similar' },
      { actor: CREATOR, action: 'withdraw', slug: 'c', creator: null, from_status: 'pending', to_status: 'withdrawn', reason: null },
      { actor: ADMIN, action: 'hide', slug: 'a', creator: null, from_status: 'published', to_status: 'hidden', reason: null },
      { actor: ADMIN, action: 'trust', slug: null, creator: CREATOR, from_status: null, to_status: null, reason: null },
      { actor: ADMIN, action: 'untrust', slug: null, creator: CREATOR, from_status: null, to_status: null, reason: null },
    ])
  })
})
