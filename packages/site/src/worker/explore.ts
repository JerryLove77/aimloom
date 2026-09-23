/**
 * The explorer's routes (spec 2026-09-22 §4): the list and detail pages, filled into a prerendered
 * shell so a shared link carries real HTML; the counted download redirect; and the list as JSON.
 * All read-only except the day counter, and none of them reads anything about the visitor.
 */
import { detailHtml, fileUrl, itemPath, listHtml, title } from '../lib/explore-view'
import { localizePath, t, type Lang } from '../i18n'
import { countDownload, creatorOf, downloadsLast30, featuredItems, getItem, listItems, parseListQuery, type Item } from './catalogue'
import { RESERVED_SLUG, RESERVED_SLUGS } from '../lib/explore-types'
import { accountBar, type Viewer } from '../lib/upload-view'
import { isAdmin, readSession } from './auth'
import { handleUploads, type Shell } from './uploads'
import type { AppEnv } from './env'
import { fail, json } from './http'

const SLUG = '[a-z0-9][a-z0-9_-]{0,63}'
const LIST = /^\/(zh|en)\/explore\/?$/
const DETAIL = new RegExp(`^/(zh|en)/explore/(${SLUG})/?$`)
const SUB = /^\/(zh|en)\/explore\/(upload|mine|review|welcome)(?:\/([a-z0-9_./-]*))?\/?$/
const DOWNLOAD = new RegExp(`^/d/(${SLUG})$`)
const PAGE_CACHE = 'public, max-age=300'

const LANG_OF: Record<string, Lang> = { 'zh-CN': 'zh', en: 'en' }

async function notFound(env: AppEnv, url: URL): Promise<Response> {
  // Any path the static assets do not hold comes back as the site's 404 page, with status 404.
  return env.ASSETS.fetch(new Request(new URL('/404-explore-not-found/', url)))
}

async function shell(env: AppEnv, url: URL, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(path, url)))
}

function fillShell(res: Response, opts: { html: string; title?: string; description?: string; slug?: string; lang: Lang }): Response {
  let rw = new HTMLRewriter().on('#explore-root', { element: e => { e.setInnerContent(opts.html, { html: true }) } })
  if (opts.title !== undefined) {
    const full = `${opts.title} · ${t(opts.lang, 'site.name')}`
    rw = rw.on('title', { element: e => { e.setInnerContent(full) } })
  }
  if (opts.description !== undefined) {
    const d = opts.description
    rw = rw.on('meta[name="description"]', { element: e => { e.setAttribute('content', d) } })
  }
  if (opts.slug !== undefined) {
    const slug = opts.slug
    rw = rw
      .on('link[rel="alternate"]', { element: e => { const l = LANG_OF[e.getAttribute('hreflang') ?? '']; if (l) e.setAttribute('href', itemPath(l, slug)) } })
      .on('#lang-switch', { element: e => { e.setAttribute('href', itemPath(opts.lang === 'zh' ? 'en' : 'zh', slug)) } })
  }
  const out = rw.transform(res)
  const headers = new Headers(out.headers)
  headers.set('cache-control', PAGE_CACHE)
  return new Response(out.body, { status: 200, headers })
}

async function listPage(env: AppEnv, url: URL, lang: Lang, viewer: Viewer | null, now: Date): Promise<Response> {
  const query = parseListQuery(url.searchParams)
  const [result, featured] = await Promise.all([listItems(env.DB, query, now), featuredItems(env.DB, query.kind)])
  const res = await shell(env, url, localizePath(lang, '/explore'))
  if (!res.ok) return res
  const bar = accountBar(lang, viewer, url.pathname + url.search, url.searchParams.get('signin') === 'failed')
  const out = fillShell(res, { html: bar + listHtml(lang, query, result, featured, env.FILES_ORIGIN), lang })
  // A signed-in view is personal; the shared cache keeps only the anonymous one.
  if (viewer) out.headers.set('cache-control', 'private, no-store')
  return out
}

async function viewerOf(request: Request, env: AppEnv, now: Date): Promise<Viewer | null> {
  const session = await readSession(request, env, now)
  if (!session) return null
  const creator = await creatorOf(env.DB, session.steamId)
  return { steamId: session.steamId, admin: isAdmin(env, session.steamId), name: creator?.display_name ?? null, url: creator?.author_url ?? null }
}

async function detailPage(env: AppEnv, url: URL, lang: Lang, slug: string, now: Date): Promise<Response> {
  const item = (RESERVED_SLUGS as readonly string[]).includes(slug) ? null : await getItem(env.DB, slug)
  if (!item) return notFound(env, url)
  const res = await shell(env, url, localizePath(lang, `/explore/${RESERVED_SLUG}`))
  if (!res.ok) return res
  const downloads = await downloadsLast30(env.DB, item.slug, now)
  return fillShell(res, {
    html: detailHtml(item, lang, env.FILES_ORIGIN, downloads), lang, slug: item.slug,
    title: title(item, lang), description: lang === 'zh' ? item.summary_zh : item.summary_en,
  })
}

async function download(env: AppEnv, ctx: ExecutionContext, url: URL, method: string, slug: string, now: Date): Promise<Response> {
  const item = await getItem(env.DB, slug)
  if (!item) return notFound(env, url)
  // A HEAD (a link checker, a prefetch) is answered but not counted. A failed count never
  // blocks the download: the label says "requests", and a lost one is the honest direction.
  if (method === 'GET') ctx.waitUntil(countDownload(env.DB, item.slug, now).catch(() => { console.warn('download count failed') }))
  return new Response(null, { status: 302, headers: { location: fileUrl(env.FILES_ORIGIN, item.file_key), 'cache-control': 'no-store' } })
}

const apiItem = (i: Item, origin: string) => ({
  slug: i.slug, kind: i.kind, title: { zh: i.title_zh, en: i.title_en }, author: i.author, licence: i.licence,
  fileName: i.file_name, bytes: i.bytes, sha256: i.sha256, download: `/d/${i.slug}`, file: fileUrl(origin, i.file_key),
})

async function apiList(env: AppEnv, url: URL, now: Date): Promise<Response> {
  const result = await listItems(env.DB, parseListQuery(url.searchParams), now)
  const res = json({ items: result.items.map(i => apiItem(i, env.FILES_ORIGIN)), total: result.total, page: result.page, pages: result.pages })
  res.headers.set('cache-control', PAGE_CACHE)
  return res
}

/** `null` when the path is not the explorer's. */
export async function handleExplore(request: Request, env: AppEnv, ctx: ExecutionContext, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  const isApi = path === '/api/explore/items'
  const list = LIST.exec(path); const sub = SUB.exec(path); const detail = DETAIL.exec(path); const dl = DOWNLOAD.exec(path)
  if (!isApi && !list && !sub && !detail && !dl) return null
  if (sub) {
    const lang = sub[1] as Lang
    const viewer = await viewerOf(request, env, now)
    const shellFor: Shell = {
      fill: async (page, html, pageTitle) => { const res = await shell(env, url, localizePath(lang, `/explore/${page}`)); if (!res.ok) return res; const out = fillShell(res, { html, lang, ...(pageTitle ? { title: pageTitle } : {}) }); out.headers.set('cache-control', 'private, no-store'); return out },
      notFound: () => notFound(env, url),
    }
    return handleUploads(request, env, lang, sub[2]! + (sub[3] ? `/${sub[3]}` : ''), viewer, shellFor, now)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail('METHOD_NOT_ALLOWED', 405)
  if (isApi) return apiList(env, url, now)
  if (dl) return download(env, ctx, url, request.method, dl[1]!, now)
  if ((list || detail) && !path.endsWith('/')) return Response.redirect(new URL(path + '/' + url.search, url).toString(), 301)
  if (list) return listPage(env, url, list[1] as Lang, await viewerOf(request, env, now), now)
  return detailPage(env, url, detail![1] as Lang, detail![2]!, now)
}
