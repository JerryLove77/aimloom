/**
 * The explorer's HTML, built from catalogue rows (spec 2026-09-22 §2). Pure string functions so the
 * Worker can fill a prerendered page shell and the node tests can read the output. Every value
 * that came from the catalogue passes through `esc`.
 */
import { localizePath, t, type Lang, type MessageKey } from '../i18n'
import type { Item, Kind, ListResult, ListQuery } from './explore-types'

export const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const fill = (s: string, vars: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
const tt = (lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string => esc(fill(t(lang, key), vars))

/** Where each kind lives under the game's install folder, for the "put it in the folder" step. */
export const GAME_FOLDER: Record<Kind, string> = {
  theme: 'FPSAimTrainer\\FPSAimTrainer\\Saved\\SaveGames\\Themes',
  sound: 'FPSAimTrainer\\FPSAimTrainer\\sounds',
  crosshair: 'FPSAimTrainer\\FPSAimTrainer\\crosshairs',
}
const REPORT_TO = 'feedback@aimloom.dev'

export const fileUrl = (origin: string, key: string): string => `${origin}/${key.split('/').map(encodeURIComponent).join('/')}`
/** The publish command renders a theme's preview once per language (`previews/<sha256>/<lang>.svg`). */
export const previewUrl = (origin: string, item: Item, lang: Lang): string => `${origin}/previews/${item.sha256}/${lang}.svg`
export const itemPath = (lang: Lang, slug: string): string => localizePath(lang, `/explore/${slug}`)
export const title = (item: Item, lang: Lang): string => (lang === 'zh' ? item.title_zh : item.title_en)
const summary = (item: Item, lang: Lang): string => (lang === 'zh' ? item.summary_zh : item.summary_en)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
const licenceText = (item: Item, lang: Lang): string => (item.licence === 'permission' ? tt(lang, 'explore.licence.permission') : esc(item.licence))
const codeKind = (code: string): 'cs2' | 'valorant' => (/^CSGO-/i.test(code.trim()) ? 'cs2' : 'valorant')

function listHref(lang: Lang, q: Partial<ListQuery>): string {
  const p = new URLSearchParams()
  if (q.kind && q.kind !== 'theme') p.set('kind', q.kind)
  if (q.q) p.set('q', q.q)
  if (q.sort && q.sort !== 'new') p.set('sort', q.sort)
  if (q.page && q.page > 1) p.set('page', String(q.page))
  const s = p.toString()
  return localizePath(lang, '/explore') + (s ? `?${s}` : '')
}

function preview(item: Item, lang: Lang, origin: string, large: boolean): string {
  const alt = tt(lang, 'explore.preview.alt', { title: title(item, lang) })
  if (item.kind === 'theme') {
    return `<img class="ex-theme" src="${esc(previewUrl(origin, item, lang))}" alt="${alt}"${large ? '' : ' loading="lazy"'} width="640" height="360" />`
  }
  if (item.kind === 'crosshair') {
    const src = esc(fileUrl(origin, item.file_key))
    return `<div class="ex-swatches"><figure class="ex-swatch ex-swatch--dark"><img src="${src}" alt="${alt}" loading="lazy" />${large ? `<figcaption>${tt(lang, 'explore.dark')}</figcaption>` : ''}</figure>`
      + `<figure class="ex-swatch ex-swatch--light"><img src="${src}" alt=""  loading="lazy" />${large ? `<figcaption>${tt(lang, 'explore.light')}</figcaption>` : ''}</figure></div>`
  }
  const src = esc(fileUrl(origin, item.file_key))
  if (large) return `<div class="ex-sound ex-sound--large"><audio controls preload="none" src="${src}"></audio></div>`
  return `<div class="ex-sound"><button type="button" class="button button--primary ex-listen" data-src="${src}" data-stop="${tt(lang, 'explore.stopListen')}" data-listen="${tt(lang, 'explore.listen')}">▶ ${tt(lang, 'explore.listen')}</button><span class="ex-sound__name mono">${esc(item.file_name)}</span></div>`
}

export function card(item: Item, lang: Lang, origin: string): string {
  return `<li class="ex-card">${preview(item, lang, origin, false)}`
    + `<h3 class="ex-card__title"><a href="${esc(itemPath(lang, item.slug))}">${esc(title(item, lang))}</a></h3>`
    + `<p class="ex-card__meta"><span>${esc(item.author)}</span><span class="ex-badge">${licenceText(item, lang)}</span><span class="mono ex-card__size">${formatBytes(item.bytes)}</span></p></li>`
}

export function listHtml(lang: Lang, query: ListQuery, result: ListResult, featured: Item[], origin: string): string {
  const kind = query.kind
  const tabs = (['theme', 'sound', 'crosshair'] as const).map(k => `<a href="${esc(listHref(lang, { kind: k }))}"${k === kind ? ' aria-current="page"' : ''}>${tt(lang, `explore.tab.${k}`)}</a>`).join('')
  const sortOptions = [`<option value="new"${result.popularAvailable && query.sort === 'popular' ? '' : ' selected'}>${tt(lang, 'explore.sort.new')}</option>`]
  if (result.popularAvailable) sortOptions.push(`<option value="popular"${query.sort === 'popular' ? ' selected' : ''}>${tt(lang, 'explore.sort.popular')}</option>`)
  const toolbar = `<div class="ex-toolbar"><nav class="ex-tabs" aria-label="${tt(lang, 'explore.tabs.aria')}">${tabs}</nav>`
    + `<form class="ex-search" method="get" action="${esc(localizePath(lang, '/explore'))}" role="search">`
    + `<input type="hidden" name="kind" value="${kind}" />`
    + `<label class="visually-hidden" for="ex-q">${tt(lang, `explore.search.${kind}`)}</label>`
    + `<input id="ex-q" type="search" name="q" maxlength="64" value="${esc(query.q)}" placeholder="${tt(lang, `explore.search.${kind}`)}…" />`
    + (result.popularAvailable ? `<label class="visually-hidden" for="ex-sort">${tt(lang, 'explore.sort.label')}</label><select id="ex-sort" name="sort">${sortOptions.join('')}</select>` : '')
    + `<button type="submit" class="button button--secondary">${tt(lang, 'explore.search.submit')}</button></form></div>`
  const showFeatured = featured.length > 0 && query.q === '' && result.page === 1
  const featuredHtml = showFeatured
    ? `<section class="ex-section" aria-labelledby="ex-featured"><div class="ex-head"><h2 id="ex-featured">${tt(lang, 'explore.featured')}</h2><p class="muted">${tt(lang, 'explore.featured.note')}</p></div><ul class="ex-grid">${featured.map(i => card(i, lang, origin)).join('')}</ul></section>`
    : ''
  let body: string
  if (result.total === 0 && query.q) {
    body = `<div class="panel ex-empty"><h3>${tt(lang, `explore.nomatch.${kind}`, { q: query.q })}</h3><p>${tt(lang, 'explore.nomatch.body')}</p><a class="button button--secondary" href="${esc(listHref(lang, { kind }))}">${tt(lang, 'explore.nomatch.clear')}</a></div>`
  } else if (result.total === 0) {
    body = `<div class="panel ex-empty"><h3>${tt(lang, `explore.empty.${kind}`)}</h3><p>${tt(lang, 'explore.empty.body')}</p></div>`
  } else {
    const pager = result.pages > 1
      ? `<nav class="ex-pager" aria-label="${tt(lang, 'explore.pagination.aria')}">`
        + (result.page > 1 ? `<a class="button button--secondary" rel="prev" href="${esc(listHref(lang, { ...query, page: result.page - 1 }))}">${tt(lang, 'explore.prev')}</a>` : '')
        + `<span class="muted">${tt(lang, 'explore.page', { page: result.page, pages: result.pages })}</span>`
        + (result.page < result.pages ? `<a class="button button--secondary" rel="next" href="${esc(listHref(lang, { ...query, page: result.page + 1 }))}">${tt(lang, 'explore.next')}</a>` : '')
        + `</nav>`
      : ''
    body = `<ul class="ex-grid">${result.items.map(i => card(i, lang, origin)).join('')}</ul>${pager}`
  }
  return toolbar + featuredHtml
    + `<section class="ex-section" aria-labelledby="ex-all"><div class="ex-head"><h2 id="ex-all">${tt(lang, `explore.all.${kind}`)}</h2><p class="muted">${tt(lang, 'explore.count', { n: result.total })}</p></div>${body}</section>`
}

export function detailHtml(item: Item, lang: Lang, origin: string, downloads: number): string {
  const kind = item.kind
  const crumbs = `<nav class="ex-crumbs" aria-label="${tt(lang, 'explore.breadcrumb.aria')}"><a href="${esc(localizePath(lang, '/explore'))}">${tt(lang, 'explore.title')}</a> / `
    + `<a href="${esc(listHref(lang, { kind }))}">${tt(lang, `explore.tab.${kind}`)}</a> / <span aria-current="page">${esc(title(item, lang))}</span></nav>`
  const note = kind === 'theme' ? tt(lang, 'explore.approx.long') : kind === 'sound' ? tt(lang, 'explore.noAutoplay') : tt(lang, 'explore.cross.note')
  const previewPanel = `<div class="panel ex-preview">${preview(item, lang, origin, true)}<p class="small muted">${note}</p></div>`
  // The publish command only accepts https links; this check makes that true of any row.
  const author = item.author_url && /^https:\/\/[^\s"'<>]+$/.test(item.author_url)
    ?`<a href="${esc(item.author_url)}" rel="noopener nofollow ugc">${esc(item.author)}</a> ↗`
    : esc(item.author)
  const code = kind === 'crosshair' && item.code
    ? `<div class="ex-box ex-code"><div class="ex-box__head"><h2>${tt(lang, codeKind(item.code) === 'cs2' ? 'explore.code.cs2' : 'explore.code.valorant')}</h2>`
      + `<button type="button" class="button button--secondary ex-copy" data-copied="${tt(lang, 'explore.code.copied')}">${tt(lang, 'explore.code.copy')}</button></div>`
      + `<p class="mono ex-code__text">${esc(item.code)}</p>`
      + `<a href="${esc(localizePath(lang, '/crosshair') + '#code=' + encodeURIComponent(item.code))}">${tt(lang, 'explore.code.open')}</a></div>`
    : ''
  const info = `<div class="ex-info"><h1>${esc(title(item, lang))}</h1>`
    + `<p class="ex-by">${tt(lang, 'explore.by')} ${author}</p>`
    + `<p class="ex-tags"><span class="ex-badge">${licenceText(item, lang)}</span><span class="muted small">${tt(lang, 'explore.published', { date: item.published_at.slice(0, 10) })}</span></p>`
    + (summary(item, lang) ? `<p>${esc(summary(item, lang))}</p>` : '') + code
    + `<div class="ex-box ex-file" role="group" aria-label="${tt(lang, 'explore.file.aria')}"><p class="ex-file__row"><span class="mono">${esc(item.file_name)}</span><span class="mono muted">${formatBytes(item.bytes)}</span></p>`
    + `<p class="mono small muted ex-hash">SHA-256 ${esc(item.sha256)}</p></div>`
    + `<a class="button button--primary ex-download" href="/d/${esc(encodeURIComponent(item.slug))}" download>${tt(lang, 'explore.download', { file: item.file_name })}</a>`
    + `<p class="small muted">${tt(lang, 'explore.downloads', { n: downloads })}</p></div>`
  const how = `<section class="panel ex-how" aria-labelledby="ex-how"><h2 id="ex-how">${tt(lang, 'explore.how.title')}</h2><ol>`
    + `<li>${tt(lang, 'explore.how.download')}</li><li>${tt(lang, `explore.how.app.${kind}`)}</li>`
    + `<li>${tt(lang, `explore.how.folder.${kind}`)}<br /><code>${esc(GAME_FOLDER[kind])}</code></li></ol>`
    + `<p>${tt(lang, 'explore.noApp')} <a href="${esc(localizePath(lang, '/download'))}">${tt(lang, 'explore.getApp')}</a></p></section>`
  const licenceLine = item.licence === 'permission' ? tt(lang, 'explore.licence.permission.long') : `${tt(lang, 'explore.licence')}: ${esc(item.licence)}`
  const report = `mailto:${REPORT_TO}?subject=${encodeURIComponent(`Aimloom Explore: ${item.slug}`)}`
  const foot = `<p class="small muted ex-foot">${licenceLine} · <a href="${esc(report)}">${tt(lang, 'explore.report')}</a></p>`
  return crumbs + `<div class="ex-main">${previewPanel}${info}</div>` + how + foot
}
