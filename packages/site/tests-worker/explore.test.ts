import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { handleExplore } from '../src/worker/explore'
import { PAGE_SIZE, utcDay } from '../src/worker/catalogue'
import worker from '../src/worker/index'
import type { AppEnv } from '../src/worker/env'

const base = testEnv as unknown as Pick<AppEnv, 'DB'>
const NOW = new Date('2026-10-20T12:00:00Z')
const shellHtml = (lang: string) => `<!doctype html><html><head><title>Explore · Aimloom</title><meta name="description" content="shell" />`
  + `<link rel="alternate" hreflang="zh-CN" href="/zh/explore/" /><link rel="alternate" hreflang="en" href="/en/explore/" /></head>`
  + `<body><a id="lang-switch" href="/${lang === 'zh' ? 'en' : 'zh'}/explore/">x</a><div id="explore-root"></div></body></html>`
const assets = {
  fetch: async (req: Request) => {
    const p = new URL(req.url).pathname
    const m = /^\/(zh|en)\/explore\/(item-shell\/)?$/.exec(p)
    return m ? new Response(shellHtml(m[1]!), { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('the 404 page', { status: 404 })
  },
}
const env = { ...base, ASSETS: assets, FILES_ORIGIN: 'https://dl.test.invalid' } as unknown as AppEnv
function context() {
  const pending: Promise<unknown>[] = []
  return { ctx: { waitUntil: (p: Promise<unknown>) => { pending.push(p) }, passThroughOnException() {} } as unknown as ExecutionContext, settle: () => Promise.all(pending) }
}
const get = async (path: string, method = 'GET') => {
  const { ctx, settle } = context()
  const r = await handleExplore(new Request(`https://aimloom.dev${path}`, { method, redirect: 'manual' }), env, ctx, NOW)
  await settle()
  return r
}

interface Seed { slug: string; kind?: string; status?: string; title_zh?: string; title_en?: string; file_name?: string; published_at?: string; featured?: number | null; code?: string | null; author_url?: string | null }
async function seed(...rows: Seed[]): Promise<void> {
  await base.DB.batch(rows.map(r => base.DB.prepare(
    `INSERT INTO item (slug, kind, status, title_zh, title_en, summary_zh, summary_en, author, author_url, licence, file_name, file_key, bytes, sha256, code, featured, published_at)
     VALUES (?, ?, ?, ?, ?, '中文简介', 'English summary', 'Sample author', ?, 'CC0', ?, ?, 3174, ?, ?, ?, ?)`,
  ).bind(r.slug, r.kind ?? 'theme', r.status ?? 'published', r.title_zh ?? `标题 ${r.slug}`, r.title_en ?? `Title ${r.slug}`, r.author_url ?? null,
    r.file_name ?? `${r.slug}.json`, `files/${r.slug.padEnd(64, '0').slice(0, 64)}/${r.file_name ?? `${r.slug}.json`}`, 'a'.repeat(64), r.code ?? null, r.featured ?? null, r.published_at ?? '2026-10-01T00:00:00Z')))
}
const countOf = (slug: string) => base.DB.prepare('SELECT COALESCE(SUM(count), 0) AS c FROM download_daily WHERE slug = ?').bind(slug).first<number>('c')

describe('the list page', () => {
  it('fills the shell with one kind\'s published items, newest first, and caches briefly', async () => {
    await seed({ slug: 'night-blue', title_zh: '夜蓝', published_at: '2026-10-02T00:00:00Z' }, { slug: 'warm-room', title_zh: '暖色房间' }, { slug: 'crisp-hit', kind: 'sound', file_name: 'crisp_hit.ogg' }, { slug: 'secret', status: 'hidden' })
    const r = (await get('/zh/explore/'))!
    const html = await r.text()
    expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('public, max-age=300')
    expect(html.indexOf('夜蓝')).toBeGreaterThan(-1); expect(html.indexOf('夜蓝')).toBeLessThan(html.indexOf('暖色房间'))
    expect(html).not.toContain('crisp_hit'); expect(html).not.toContain('secret')
    expect(html).toContain('<a href="/zh/explore/" aria-current="page">背景</a>')
    expect(html).toContain('href="/zh/explore/night-blue/"')
    expect(html).toContain('src="https://dl.test.invalid/previews/' + 'a'.repeat(64) + '/zh.svg"')
  })
  it('switches kind by the query string and shows a Listen button for sounds', async () => {
    await seed({ slug: 'crisp-hit', kind: 'sound', file_name: 'crisp hit.ogg' })
    const html = await (await get('/en/explore/?kind=sound'))!.text()
    expect(html).toContain('aria-current="page">Sounds</a>')
    expect(html).toContain('data-src="https://dl.test.invalid/files/crisp-hit' + '0'.repeat(55) + '/crisp%20hit.ogg"')
  })
  it('searches titles in both languages and file names, and treats % and _ as plain text', async () => {
    await seed({ slug: 'night-blue', title_zh: '夜蓝' }, { slug: 'warm-room', title_en: 'Warm Room', file_name: 'warm_room.json' })
    expect(await (await get('/zh/explore/?q=' + encodeURIComponent('夜')))!.text()).toContain('夜蓝')
    const en = await (await get('/en/explore/?q=warm'))!.text()
    expect(en).toContain('Warm Room'); expect(en).not.toContain('Title night-blue')
    expect(await (await get('/en/explore/?q=' + encodeURIComponent('m_r')))!.text()).toContain('Warm Room')
    expect(await (await get('/en/explore/?q=' + encodeURIComponent('%')))!.text()).toContain('No background matches &quot;%&quot;')
  })
  it('says which search found nothing, and that an empty tab is empty', async () => {
    await seed({ slug: 'night-blue' })
    const miss = await (await get('/zh/explore/?q=' + encodeURIComponent('<b>霓虹')))!.text()
    expect(miss).toContain('没有匹配「&lt;b&gt;霓虹」的背景'); expect(miss).toContain('清空搜索')
    const empty = await (await get('/zh/explore/?kind=crosshair'))!.text()
    expect(empty).toContain('这里还没有准星')
    // Signed out, the way in is Steam sign-in, returning to this very page.
    expect(empty).toContain('href="/auth/steam/login?next=%2Fzh%2Fexplore%2F%3Fkind%3Dcrosshair"')
  })
  it('pages 24 at a time and links the neighbouring pages', async () => {
    await seed(...Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({ slug: `t${String(i).padStart(2, '0')}`, published_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}Z` })))
    const one = await (await get('/en/explore/'))!.text()
    expect(one.match(/class="ex-card"/g)).toHaveLength(PAGE_SIZE); expect(one).toContain('Page 1 of 2'); expect(one).toContain('href="/en/explore/?page=2"')
    const two = await (await get('/en/explore/?page=2'))!.text()
    expect(two.match(/class="ex-card"/g)).toHaveLength(1); expect(two).toContain('rel="prev"')
  })
  it('shows the Featured row only on the first unsearched page', async () => {
    await seed({ slug: 'picked', featured: 1 }, { slug: 'other' })
    expect(await (await get('/en/explore/'))!.text()).toContain('Picked by us, not ranked by downloads')
    expect(await (await get('/en/explore/?q=other'))!.text()).not.toContain('Picked by us')
  })
  it('offers "most downloaded" only once the counter has 30 days behind it, and then sorts by it', async () => {
    await seed({ slug: 'old', published_at: '2026-10-01T00:00:00Z' }, { slug: 'new', published_at: '2026-10-10T00:00:00Z' })
    await base.DB.prepare('INSERT INTO download_daily (slug, day, count) VALUES (?, ?, 5)').bind('old', utcDay(NOW, -28)).run()
    expect(await (await get('/en/explore/'))!.text()).not.toContain('Most downloaded')
    await base.DB.prepare('INSERT INTO download_daily (slug, day, count) VALUES (?, ?, 1)').bind('old', utcDay(NOW, -29)).run()
    const html = await (await get('/en/explore/?sort=popular'))!.text()
    expect(html).toContain('<option value="popular" selected>Most downloaded, 30 days</option>')
    expect(html.indexOf('Title old')).toBeLessThan(html.indexOf('Title new'))
  })
  it('adds the trailing slash like every other page', async () => {
    const r = (await get('/zh/explore?kind=sound'))!
    expect(r.status).toBe(301); expect(r.headers.get('location')).toBe('https://aimloom.dev/zh/explore/?kind=sound')
  })
})

describe('the detail page', () => {
  it('fills the shell and points title, description, alternates and the language switch at the item', async () => {
    await seed({ slug: 'night-blue', title_zh: '夜蓝', title_en: 'Night Blue' })
    const html = await (await get('/en/explore/night-blue/'))!.text()
    expect(html).toContain('<title>Night Blue · Aimloom</title>'); expect(html).toContain('content="English summary"')
    expect(html).toContain('hreflang="zh-CN" href="/zh/explore/night-blue/"'); expect(html).toContain('hreflang="en" href="/en/explore/night-blue/"')
    expect(html).toContain('id="lang-switch" href="/zh/explore/night-blue/"')
    expect(html).toContain('href="/d/night-blue"'); expect(html).toContain('SHA-256 ' + 'a'.repeat(64))
    expect(html).toContain('FPSAimTrainer\\FPSAimTrainer\\Saved\\SaveGames\\Themes')
  })
  it('escapes catalogue text and links an author only over https', async () => {
    await seed({ slug: 'x', title_en: '<script>alert(1)</script>', author_url: 'javascript:alert(1)' }, { slug: 'y', author_url: 'https://example.com/a' })
    const x = await (await get('/en/explore/x/'))!.text()
    expect(x).not.toContain('<script>alert(1)</script>'); expect(x).toContain('&lt;script&gt;'); expect(x).not.toContain('javascript:')
    expect(await (await get('/en/explore/y/'))!.text()).toContain('<a href="https://example.com/a" rel="noopener nofollow ugc">')
  })
  it('shows a crosshair\'s code with a link into the tool that keeps the code in the fragment', async () => {
    await seed({ slug: 'small-dot', kind: 'crosshair', file_name: 'small_dot.png', code: 'CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE' })
    const html = await (await get('/zh/explore/small-dot/'))!.text()
    expect(html).toContain('CS2 准星代码'); expect(html).toContain('href="/zh/crosshair/#code=CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE"')
  })
  it('is a 404 for an unknown, hidden or reserved slug', async () => {
    await seed({ slug: 'secret', status: 'hidden' })
    for (const p of ['/en/explore/nope/', '/en/explore/secret/', '/en/explore/item-shell/']) {
      const r = (await get(p))!; expect(r.status, p).toBe(404); expect(await r.text()).toBe('the 404 page')
    }
  })
})

describe('the download redirect', () => {
  it('counts a GET for today and redirects to the file, uncached', async () => {
    await seed({ slug: 'night-blue', file_name: 'Night Blue.json' })
    const r = (await get('/d/night-blue'))!
    expect(r.status).toBe(302); expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('location')).toBe(`https://dl.test.invalid/files/${'night-blue'.padEnd(64, '0')}/Night%20Blue.json`)
    await get('/d/night-blue')
    expect(await base.DB.prepare('SELECT day, count FROM download_daily').all()).toMatchObject({ results: [{ day: '2026-10-20', count: 2 }] })
  })
  it('answers a HEAD without counting it, and 404s an unknown or hidden item', async () => {
    await seed({ slug: 'night-blue' }, { slug: 'secret', status: 'hidden' })
    expect((await get('/d/night-blue', 'HEAD'))!.status).toBe(302); expect(await countOf('night-blue')).toBe(0)
    expect((await get('/d/nope'))!.status).toBe(404); expect((await get('/d/secret'))!.status).toBe(404)
  })
  it('refuses other methods', async () => {
    expect((await get('/d/night-blue', 'POST'))!.status).toBe(405)
  })
})

describe('the JSON list and the router', () => {
  it('returns one page of published items with their download links', async () => {
    await seed({ slug: 'night-blue', title_en: 'Night Blue' })
    const body = await (await get('/api/explore/items?kind=theme'))!.json() as { items: { slug: string; download: string; title: { en: string } }[]; total: number }
    expect(body.total).toBe(1); expect(body.items[0]).toMatchObject({ slug: 'night-blue', download: '/d/night-blue', title: { en: 'Night Blue' } })
  })
  it('leaves every other path to the rest of the Worker', async () => {
    expect(await get('/zh/explore/a/b/')).toBeNull(); expect(await get('/zh/download/')).toBeNull(); expect(await get('/api/reports')).toBeNull()
  })
  it('is reached through the Worker\'s fetch handler', async () => {
    await seed({ slug: 'night-blue' })
    const r = await worker.fetch(new Request('https://aimloom.dev/d/night-blue', { redirect: 'manual' }), env, context().ctx)
    expect(r.status).toBe(302)
  })
})
