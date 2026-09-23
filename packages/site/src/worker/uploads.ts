/**
 * Upload, the creator's page and the review page (spec 2026-09-22 §11.3–§11.4). Every write needs
 * a session and the site's own Origin; the review routes need an admin SteamID. A trusted
 * creator's file goes straight to the public bucket; anyone else's waits in the private one.
 */
import { localizePath, t, type Lang } from '../i18n'
import { renderSchemePreview } from '../../../core/src/scheme/preview'
import { parseScheme } from '../../../core/src/scheme/document'
import { checkFile, CONTENT_TYPE, extensionOf, parseManifest, PublishError, sha256Hex, UPLOAD_LICENCES, type Kind } from '../lib/item-checks'
import type { Item } from '../lib/explore-types'
import { accountBar, emptyForm, MAX_UPLOAD_BYTES, mineHtml, reviewHtml, uploadDoneHtml, uploadFormHtml, UPLOADS_PER_DAY, welcomeHtml, type FormValues, type Viewer } from '../lib/upload-view'
import { creatorOf, fileNameTaken, freeSlug, insertItem, itemAnyStatus, liveItems, mine, pendingItems, rememberCreator, setStatus, setTrusted, trustedCreators, uploadsToday } from './catalogue'
import { requireSameOrigin } from './auth'
import type { AppEnv } from './env'
import { fail } from './http'

export interface Shell { fill(page: string, html: string, title?: string): Promise<Response>; notFound(): Promise<Response> }

const isKind = (v: unknown): v is Kind => v === 'theme' || v === 'sound' || v === 'crosshair'
const str = (fd: FormData, name: string, max: number): string => { const v = fd.get(name); return typeof v === 'string' ? v.trim().slice(0, max) : '' }
const loginFor = (request: Request, lang: Lang, page: string): Response => Response.redirect(new URL(`/auth/steam/login?next=${encodeURIComponent(localizePath(lang, `/explore/${page}`))}`, request.url).toString(), 302)
const publicMeta = (name: string) => ({ contentType: CONTENT_TYPE[extensionOf(name)]!, contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, cacheControl: 'public, max-age=31536000, immutable' })

/** Puts a file and, for a theme, its two previews into the public bucket. */
async function publishToFiles(env: AppEnv, key: string, name: string, bytes: Uint8Array, hash: string, previews: { zh: string; en: string } | null): Promise<void> {
  await env.FILES.put(key, bytes, { httpMetadata: publicMeta(name) })
  if (previews) for (const lang of ['zh', 'en'] as const) await env.FILES.put(`previews/${hash}/${lang}.svg`, previews[lang], { httpMetadata: { contentType: 'image/svg+xml', cacheControl: 'public, max-age=31536000, immutable' } })
}

async function upload(request: Request, env: AppEnv, lang: Lang, viewer: Viewer | null, shell: Shell, now: Date): Promise<Response> {
  // The display name belongs to the account (set at the first sign-in), never to the form.
  if (viewer && !viewer.name) return welcomeFirst(request, lang, 'upload')
  if (request.method === 'GET') return shell.fill('upload', uploadFormHtml(lang, emptyForm(), [], viewer), t(lang, 'explore.upload.title'))
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
  if (!viewer) return fail('UNAUTHORIZED', 401)
  const refused = requireSameOrigin(request); if (refused) return refused
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return shell.fill('upload', uploadFormHtml(lang, emptyForm(), [t(lang, 'explore.upload.error.tooLarge')], viewer), t(lang, 'explore.upload.title'))
  const fd = await request.formData()
  const kindRaw = fd.get('kind')
  const v: FormValues = {
    kind: isKind(kindRaw) ? kindRaw : 'theme', title_zh: str(fd, 'title_zh', 80), title_en: str(fd, 'title_en', 80), summary_zh: str(fd, 'summary_zh', 400), summary_en: str(fd, 'summary_en', 400),
    author: viewer.name ?? '', author_url: viewer.url ?? '', licence: str(fd, 'licence', 40), code: str(fd, 'code', 512), confirm: fd.get('confirm') === 'yes',
  }
  const errors: string[] = []
  const file = fd.get('file')
  const hasFile = file instanceof File && file.size > 0
  if (!hasFile) errors.push(t(lang, 'explore.upload.error.file'))
  else if (file.size > MAX_UPLOAD_BYTES) errors.push(t(lang, 'explore.upload.error.tooLarge'))
  // The kind follows the extension; the name defaults to the stem (the form asks for neither).
  if (hasFile) {
    const ext = extensionOf(file.name)
    if (!isKind(kindRaw)) v.kind = ext === '.png' ? 'crosshair' : ext === '.wav' || ext === '.ogg' ? 'sound' : 'theme'
    if (!v.title_zh && !v.title_en) { const stem = file.name.slice(0, file.name.length - ext.length).trim().slice(0, 80); v.title_zh = stem; v.title_en = stem }
  }
  if (!v.confirm) errors.push(t(lang, 'explore.upload.error.confirm'))
  if (!v.title_zh && !v.title_en) errors.push(t(lang, 'explore.upload.error.title'))
  if (!(UPLOAD_LICENCES as readonly string[]).includes(v.licence)) errors.push(t(lang, 'explore.upload.error.licence'))
  const form = (errs: string[]) => shell.fill('upload', uploadFormHtml(lang, v, errs, viewer), t(lang, 'explore.upload.title'))
  if (errors.length) return form(errors)
  const fileName = (file as File).name
  const bytes = new Uint8Array(await (file as File).arrayBuffer())
  let slug: string; let previews: { zh: string; en: string } | null
  try {
    slug = await freeSlug(env.DB, fileName)
    // The same rules the publish command applies, through the same parser.
    parseManifest(new TextEncoder().encode(JSON.stringify({ slug, kind: v.kind, title: { zh: v.title_zh || v.title_en, en: v.title_en || v.title_zh }, summary: { zh: v.summary_zh || v.summary_en, en: v.summary_en || v.summary_zh }, author: v.author, authorUrl: v.author_url || undefined, licence: v.licence, code: v.kind === 'crosshair' && v.code ? v.code : undefined })))
    previews = checkFile(v.kind, fileName, bytes).previews
  } catch (e) { return form([e instanceof PublishError ? e.message : String(e)]) }
  if (await fileNameTaken(env.DB, v.kind, fileName)) return form([t(lang, 'explore.upload.error.duplicate')])
  const today = await uploadsToday(env.DB, viewer.steamId, now)
  if (today >= UPLOADS_PER_DAY) return form([t(lang, 'explore.upload.error.limit').replace('{n}', String(today))])
  const trusted = (await creatorOf(env.DB, viewer.steamId))?.trusted === 1
  const hash = await sha256Hex(bytes)
  const key = trusted ? `files/${hash}/${fileName}` : `pending/${slug}/${fileName}`
  if (trusted) await publishToFiles(env, key, fileName, bytes, hash, previews)
  else await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: CONTENT_TYPE[extensionOf(fileName)]! } })
  const row: Omit<Item, 'featured'> = {
    slug, kind: v.kind, status: trusted ? 'published' : 'pending', title_zh: v.title_zh || v.title_en, title_en: v.title_en || v.title_zh, summary_zh: v.summary_zh || v.summary_en, summary_en: v.summary_en || v.summary_zh,
    author: v.author, author_url: v.author_url || null, licence: v.licence, file_name: fileName, file_key: key, bytes: bytes.length, sha256: hash,
    code: v.kind === 'crosshair' && v.code ? v.code : null, published_at: now.toISOString(), source: 'upload', uploader: viewer.steamId, uploaded_at: now.toISOString(), reject_reason: null,
  }
  await insertItem(env.DB, row)
  return shell.fill('upload', uploadDoneHtml(lang, { ...row, featured: null }, viewer), t(lang, 'explore.upload.title'))
}

const welcomeFirst = (request: Request, lang: Lang, page: string): Response => Response.redirect(new URL(`${localizePath(lang, '/explore/welcome')}?next=${encodeURIComponent(localizePath(lang, `/explore/${page}`))}`, request.url).toString(), 302)

async function welcome(request: Request, env: AppEnv, lang: Lang, viewer: Viewer | null, shell: Shell, now: Date): Promise<Response> {
  if (!viewer) return request.method === 'GET' ? loginFor(request, lang, 'welcome') : fail('UNAUTHORIZED', 401)
  const url = new URL(request.url)
  const next = (v: string | null) => (v && /^\/(zh|en)\/explore\/[a-z/]*$/.test(v) ? v : localizePath(lang, '/explore'))
  if (request.method === 'GET') return shell.fill('welcome', welcomeHtml(lang, viewer, { author: viewer.name ?? '', author_url: viewer.url ?? '' }, [], next(url.searchParams.get('next'))), t(lang, 'explore.welcome.title'))
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
  const refused = requireSameOrigin(request); if (refused) return refused
  const fd = await request.formData()
  const author = str(fd, 'author', 80); const author_url = str(fd, 'author_url', 300); const to = next(str(fd, 'next', 200))
  const errors: string[] = []
  if (!author) errors.push(t(lang, 'explore.upload.error.author'))
  if (author_url && !/^https:\/\/[^\s"'<>]+$/.test(author_url)) errors.push(t(lang, 'explore.upload.error.authorUrl'))
  if (errors.length) return shell.fill('welcome', welcomeHtml(lang, viewer, { author, author_url }, errors, to), t(lang, 'explore.welcome.title'))
  await rememberCreator(env.DB, viewer.steamId, author, author_url || null, now)
  return Response.redirect(new URL(to, request.url).toString(), 303)
}

async function minePage(request: Request, env: AppEnv, lang: Lang, viewer: Viewer | null, shell: Shell, sub: string): Promise<Response> {
  if (!viewer) return request.method === 'GET' ? loginFor(request, lang, 'mine') : fail('UNAUTHORIZED', 401)
  if (!viewer.name) return welcomeFirst(request, lang, 'mine')
  if (sub === 'mine/withdraw') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
    const refused = requireSameOrigin(request); if (refused) return refused
    const slug = str(await request.formData(), 'slug', 64)
    const item = await itemAnyStatus(env.DB, slug)
    if (item && item.uploader === viewer.steamId && (item.status === 'pending' || item.status === 'published')) {
      await setStatus(env.DB, slug, 'withdrawn')
      if (item.status === 'pending') await env.UPLOADS.delete(item.file_key)
    }
    return Response.redirect(new URL(localizePath(lang, '/explore/mine'), request.url).toString(), 303)
  }
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405)
  return shell.fill('mine', mineHtml(lang, await mine(env.DB, viewer.steamId), viewer), t(lang, 'explore.mine.title'))
}

async function reviewPage(env: AppEnv, lang: Lang, viewer: Viewer, shell: Shell, error: string | null): Promise<Response> {
  const [pending, live, trusted] = await Promise.all([pendingItems(env.DB), liveItems(env.DB), trustedCreators(env.DB)])
  return shell.fill('review', reviewHtml(lang, pending, live, trusted, viewer, error), t(lang, 'explore.review.title'))
}

async function review(request: Request, env: AppEnv, lang: Lang, viewer: Viewer | null, shell: Shell, sub: string, now: Date): Promise<Response> {
  // A non-admin sees the same 404 as an unknown slug: the page's existence is not advertised.
  if (!viewer?.admin) return shell.notFound()
  const file = /^review\/file\/([a-z0-9][a-z0-9_-]{0,63})(\.svg)?$/.exec(sub)
  if (file) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405)
    const item = await itemAnyStatus(env.DB, file[1]!)
    if (!item || item.status !== 'pending') return shell.notFound()
    const obj = await env.UPLOADS.get(item.file_key)
    if (!obj) return shell.notFound()
    if (file[2]) {
      const svg = renderSchemePreview(parseScheme(new Uint8Array(await obj.arrayBuffer())), lang)
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, no-store' } })
    }
    return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
  }
  if (sub === 'review/action') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
    const refused = requireSameOrigin(request); if (refused) return refused
    const fd = await request.formData()
    const action = str(fd, 'action', 16); const slug = str(fd, 'slug', 64); const reason = str(fd, 'reason', 400)
    const item = slug ? await itemAnyStatus(env.DB, slug) : null
    if (action === 'approve' && item?.status === 'pending') {
      const obj = await env.UPLOADS.get(item.file_key)
      if (obj) {
        const bytes = new Uint8Array(await obj.arrayBuffer())
        const { previews } = checkFile(item.kind, item.file_name, bytes)
        const hash = await sha256Hex(bytes)
        const key = `files/${hash}/${item.file_name}`
        await publishToFiles(env, key, item.file_name, bytes, hash, previews)
        await setStatus(env.DB, slug, 'published', { publishedAt: now.toISOString(), fileKey: key })
        await env.UPLOADS.delete(item.file_key)
      }
    } else if (action === 'reject' && item?.status === 'pending') {
      if (!reason) return reviewPage(env, lang, viewer, shell, t(lang, 'explore.review.error.reason'))
      await setStatus(env.DB, slug, 'rejected', { reason })
      await env.UPLOADS.delete(item.file_key)
    } else if (action === 'hide' && item?.status === 'published') {
      await setStatus(env.DB, slug, 'hidden')
    } else if (action === 'trust' || action === 'untrust') {
      const steamId = item?.uploader ?? str(fd, 'steam_id', 20)
      if (/^7656119\d{10}$/.test(steamId)) await setTrusted(env.DB, steamId, action === 'trust', now)
    }
    return Response.redirect(new URL(localizePath(lang, '/explore/review'), request.url).toString(), 303)
  }
  if (sub !== 'review' || request.method !== 'GET') return shell.notFound()
  return reviewPage(env, lang, viewer, shell, null)
}

/** `sub` is the path under /<lang>/explore/ without its trailing slash: `upload`, `mine`, `review/action`, … */
export async function handleUploads(request: Request, env: AppEnv, lang: Lang, sub: string, viewer: Viewer | null, shell: Shell, now: Date): Promise<Response> {
  if (sub === 'welcome') return welcome(request, env, lang, viewer, shell, now)
  if (sub === 'upload') return upload(request, env, lang, viewer, shell, now)
  if (sub === 'mine' || sub === 'mine/withdraw') return minePage(request, env, lang, viewer, shell, sub)
  if (sub === 'review' || sub.startsWith('review/')) return review(request, env, lang, viewer, shell, sub, now)
  return shell.notFound()
}

export { accountBar }
