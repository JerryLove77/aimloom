/**
 * HTML for sign-in, the upload form, the creator's uploads and the review queue (spec 2026-09-22
 * §11). Pure string functions like `explore-view.ts`; every catalogue or form value passes
 * through `esc`. State-changing controls are POST forms so they work without script.
 */
import { localizePath, t, type Lang, type MessageKey } from '../i18n'
import { esc, formatBytes, itemPath, title } from './explore-view'
import { UPLOAD_LICENCES, type Kind } from './item-checks'
import type { Item } from './explore-types'

const fill = (s: string, vars: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
const tt = (lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string => esc(fill(t(lang, key), vars))
export const UPLOADS_PER_DAY = 10
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export interface Viewer { steamId: string; admin: boolean }
export interface FormValues { kind: Kind; title_zh: string; title_en: string; summary_zh: string; summary_en: string; author: string; author_url: string; licence: string; code: string; confirm: boolean }
export const emptyForm = (kind: Kind = 'theme'): FormValues => ({ kind, title_zh: '', title_en: '', summary_zh: '', summary_en: '', author: '', author_url: '', licence: 'CC-BY-4.0', code: '', confirm: false })

const signOutForm = (lang: Lang, next: string): string =>
  `<form method="post" action="/auth/signout?next=${esc(encodeURIComponent(next))}" class="ex-inline"><button type="submit" class="ex-linklike">${tt(lang, 'explore.account.signOut')}</button></form>`

/** The line above the explorer's toolbar: sign in, or the signed-in creator's links. */
export function accountBar(lang: Lang, viewer: Viewer | null, next: string, signinFailed = false): string {
  if (!viewer) {
    return `<div class="ex-account"><span class="muted small">${tt(lang, 'explore.signin.entry')}</span>`
      + `<a class="button button--secondary" rel="nofollow" href="/auth/steam/login?next=${esc(encodeURIComponent(next))}">${tt(lang, 'explore.signin.button')}</a>`
      + (signinFailed ? `<p class="ex-error" role="alert">${tt(lang, 'explore.signin.failed')}</p>` : '') + `</div>`
  }
  const links = [`<a href="${esc(localizePath(lang, '/explore/upload'))}">${tt(lang, 'explore.account.upload')}</a>`, `<a href="${esc(localizePath(lang, '/explore/mine'))}">${tt(lang, 'explore.account.mine')}</a>`]
  if (viewer.admin) links.push(`<a href="${esc(localizePath(lang, '/explore/review'))}">${tt(lang, 'explore.account.review')}</a>`)
  return `<div class="ex-account"><span class="muted small">${tt(lang, 'explore.account.signedIn')} <span class="ex-badge ex-badge--ok">${tt(lang, 'explore.account.verified')}</span></span>`
    + `<nav class="ex-account__links">${links.join('')}${signOutForm(lang, next)}</nav></div>`
}

const crumbs = (lang: Lang, last: string): string => `<nav class="ex-crumbs" aria-label="${tt(lang, 'explore.breadcrumb.aria')}"><a href="${esc(localizePath(lang, '/explore'))}">${tt(lang, 'explore.title')}</a> / <span aria-current="page">${last}</span></nav>`
const field = (id: string, label: string, control: string, hint?: string): string => `<div class="ex-field"><label for="${id}">${label}</label>${control}${hint ? `<p class="small muted">${hint}</p>` : ''}</div>`
const input = (id: string, name: string, value: string, extra = ''): string => `<input id="${id}" name="${name}" value="${esc(value)}" maxlength="400" ${extra} />`

export function uploadFormHtml(lang: Lang, v: FormValues, errors: string[], viewer: Viewer | null): string {
  const here = localizePath(lang, '/explore/upload')
  const head = crumbs(lang, tt(lang, 'explore.account.upload')) + `<h1>${tt(lang, 'explore.upload.title')}</h1>` + accountBar(lang, viewer, here)
  if (!viewer) return head + `<p class="panel">${tt(lang, 'explore.upload.needSignIn')}</p>`
  const errorBox = errors.length ? `<div class="notice ex-notice-error" role="alert"><p><strong>${tt(lang, 'explore.upload.error.heading')}</strong></p><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''
  const kinds = (['theme', 'sound', 'crosshair'] as const).map(k => `<label class="ex-kind${v.kind === k ? ' is-on' : ''}"><input type="radio" name="kind" value="${k}"${v.kind === k ? ' checked' : ''} />${tt(lang, `explore.upload.kind.${k}`)}</label>`).join('')
  const licences = UPLOAD_LICENCES.map(l => `<option value="${l}"${v.licence === l ? ' selected' : ''}>${tt(lang, `explore.upload.licence.${l}`)}</option>`).join('')
  return head + errorBox
    + `<form class="panel ex-form" method="post" action="${esc(here)}" enctype="multipart/form-data">`
    + `<fieldset class="ex-kinds"><legend>${tt(lang, 'explore.upload.kind')}</legend>${kinds}</fieldset>`
    + field('up-file', tt(lang, 'explore.upload.file'), `<input id="up-file" name="file" type="file" required accept=".json,.wav,.ogg,.png" />`, tt(lang, 'explore.upload.file.hint'))
    + `<div class="ex-row">${field('up-title-zh', tt(lang, 'explore.upload.title.zh'), input('up-title-zh', 'title_zh', v.title_zh, 'maxlength="80"'))}${field('up-title-en', tt(lang, 'explore.upload.title.en'), input('up-title-en', 'title_en', v.title_en, 'maxlength="80"'), tt(lang, 'explore.upload.title.hint'))}</div>`
    + `<div class="ex-row">${field('up-summary-zh', tt(lang, 'explore.upload.summary.zh'), `<textarea id="up-summary-zh" name="summary_zh" rows="3" maxlength="400">${esc(v.summary_zh)}</textarea>`)}${field('up-summary-en', tt(lang, 'explore.upload.summary.en'), `<textarea id="up-summary-en" name="summary_en" rows="3" maxlength="400">${esc(v.summary_en)}</textarea>`, tt(lang, 'explore.upload.summary.hint'))}</div>`
    + `<div class="ex-row">${field('up-author', tt(lang, 'explore.upload.author'), input('up-author', 'author', v.author, 'maxlength="80" required'), tt(lang, 'explore.upload.author.hint'))}${field('up-url', tt(lang, 'explore.upload.authorUrl'), input('up-url', 'author_url', v.author_url, 'maxlength="300" placeholder="https://…"'), tt(lang, 'explore.upload.authorUrl.hint'))}</div>`
    + field('up-licence', tt(lang, 'explore.upload.licence'), `<select id="up-licence" name="licence">${licences}</select>`)
    + field('up-code', tt(lang, 'explore.upload.code'), input('up-code', 'code', v.code, 'maxlength="512" placeholder="CSGO-…"'))
    + `<label class="ex-confirm"><input type="checkbox" name="confirm" value="yes"${v.confirm ? ' checked' : ''} /> <span>${tt(lang, 'explore.upload.confirm')}</span></label>`
    + `<div class="ex-rules small muted"><p>${tt(lang, 'explore.upload.note.review', { n: UPLOADS_PER_DAY })}</p><p>${tt(lang, 'explore.upload.note.rules')}</p></div>`
    + `<div class="ex-actions"><a class="button button--secondary" href="${esc(localizePath(lang, '/explore'))}">${tt(lang, 'explore.upload.cancel')}</a><button type="submit" class="button button--primary">${tt(lang, 'explore.upload.submit')}</button></div></form>`
}

export function uploadDoneHtml(lang: Lang, item: Item, viewer: Viewer): string {
  const line = item.status === 'published'
    ? `${tt(lang, 'explore.upload.done.live')} <a href="${esc(itemPath(lang, item.slug))}">${esc(title(item, lang))}</a>`
    : tt(lang, 'explore.upload.done.pending')
  return crumbs(lang, tt(lang, 'explore.account.upload')) + `<h1>${tt(lang, 'explore.upload.title')}</h1>` + accountBar(lang, viewer, localizePath(lang, '/explore/upload'))
    + `<div class="panel"><p>${line}</p><p><a href="${esc(localizePath(lang, '/explore/mine'))}">${tt(lang, 'explore.account.mine')}</a> · <a href="${esc(localizePath(lang, '/explore/upload'))}">${tt(lang, 'explore.mine.new')}</a></p></div>`
}

const statusBadge = (lang: Lang, s: Item['status']): string => {
  const tone = s === 'published' ? 'ok' : s === 'rejected' ? 'bad' : s === 'pending' ? 'wait' : ''
  return `<span class="ex-badge${tone ? ` ex-badge--${tone}` : ''}">${tt(lang, `explore.mine.status.${s}` as MessageKey)}</span>`
}
const fileLine = (item: Item, lang: Lang): string => `${esc(item.file_name)} · ${formatBytes(item.bytes)} · ${tt(lang, `explore.tab.${item.kind}`)}`

export function mineHtml(lang: Lang, items: Item[], viewer: Viewer): string {
  const here = localizePath(lang, '/explore/mine')
  const rows = items.map(i => {
    const canWithdraw = i.status === 'pending' || i.status === 'published'
    const name = i.status === 'published' ? `<a href="${esc(itemPath(lang, i.slug))}">${esc(title(i, lang))}</a>` : esc(title(i, lang))
    return `<li class="ex-mine"><div><h2>${name}</h2><p class="mono small muted">${fileLine(i, lang)}</p>${i.status === 'rejected' && i.reject_reason ? `<p class="small">${esc(i.reject_reason)}</p>` : ''}</div>`
      + `<div class="ex-mine__meta">${statusBadge(lang, i.status)}<span class="small muted">${esc((i.uploaded_at ?? i.published_at).slice(0, 10))}</span>`
      + (canWithdraw ? `<form method="post" action="${esc(here + 'withdraw')}" class="ex-inline"><input type="hidden" name="slug" value="${esc(i.slug)}" /><button type="submit" class="button button--danger">${tt(lang, 'explore.mine.withdraw')}</button></form>` : '') + `</div></li>`
  }).join('')
  return crumbs(lang, tt(lang, 'explore.mine.title')) + `<div class="ex-head"><h1>${tt(lang, 'explore.mine.title')}</h1><a class="button button--primary" href="${esc(localizePath(lang, '/explore/upload'))}">${tt(lang, 'explore.mine.new')}</a></div>`
    + accountBar(lang, viewer, here)
    + (items.length ? `<ul class="ex-list">${rows}</ul>` : `<p class="panel">${tt(lang, 'explore.mine.empty')}</p>`)
    + `<p class="small muted">${tt(lang, 'explore.mine.note')}</p>`
}

export interface PendingRow extends Item { uploader_total: number; uploader_live: number }

export function reviewHtml(lang: Lang, pending: PendingRow[], live: Item[], trusted: string[], viewer: Viewer, error: string | null): string {
  const here = localizePath(lang, '/explore/review')
  const act = (slug: string, action: string, label: MessageKey, cls = 'button--secondary', extra = ''): string =>
    `<form method="post" action="${esc(here + 'action')}" class="ex-inline"><input type="hidden" name="slug" value="${esc(slug)}" /><input type="hidden" name="action" value="${action}" />${extra}<button type="submit" class="button ${cls}">${tt(lang, label)}</button></form>`
  const preview = (i: PendingRow): string => {
    const src = esc(`${here}file/${i.slug}`)
    if (i.kind === 'theme') return `<img class="ex-theme" src="${src}.svg" alt="" width="320" height="180" />`
    if (i.kind === 'crosshair') return `<div class="ex-swatches"><figure class="ex-swatch ex-swatch--dark"><img src="${src}" alt="" /></figure><figure class="ex-swatch ex-swatch--light"><img src="${src}" alt="" /></figure></div>`
    return `<audio controls preload="none" src="${src}"></audio>`
  }
  const queue = pending.map(i => `<li class="panel ex-review"><div class="ex-review__preview">${preview(i)}</div><div class="ex-review__body">`
    + `<h2>${esc(i.title_zh)} / ${esc(i.title_en)}</h2><p class="mono small muted">${fileLine(i, lang)} · ${esc(i.licence)}${i.code ? ` · ${esc(i.code)}` : ''}</p>`
    + `<p>${esc(i.summary_zh)}<br />${esc(i.summary_en)}</p>`
    + `<p class="small muted">${tt(lang, 'explore.by')} ${esc(i.author)}${i.author_url ? ` · ${esc(i.author_url)}` : ''} · ${tt(lang, 'explore.review.uploader', { id: i.uploader ?? '', total: i.uploader_total, live: i.uploader_live })}</p>`
    + `<form method="post" action="${esc(here + 'action')}" class="ex-review__actions"><input type="hidden" name="slug" value="${esc(i.slug)}" />`
    + `<label class="ex-field"><span>${tt(lang, 'explore.review.reason')}</span><input name="reason" maxlength="400" /></label>`
    + `<div class="ex-actions"><button type="submit" name="action" value="approve" class="button button--primary">${tt(lang, 'explore.review.approve')}</button>`
    + `<button type="submit" name="action" value="reject" class="button button--danger">${tt(lang, 'explore.review.reject')}</button>`
    + `<button type="submit" name="action" value="${trusted.includes(i.uploader ?? '') ? 'untrust' : 'trust'}" class="button button--secondary">${tt(lang, trusted.includes(i.uploader ?? '') ? 'explore.review.untrust' : 'explore.review.trust')}</button></div></form></div></li>`).join('')
  const liveRows = live.map(i => `<li class="ex-mine"><div><h2><a href="${esc(itemPath(lang, i.slug))}">${esc(title(i, lang))}</a></h2><p class="mono small muted">${fileLine(i, lang)} · ${i.source === 'upload' ? esc(i.uploader ?? '') : 'maintainer'}</p></div><div class="ex-mine__meta">${act(i.slug, 'hide', 'explore.review.hide', 'button--danger')}</div></li>`).join('')
  const trustedRows = trusted.map(id => `<li class="ex-mine"><span class="mono">${esc(id)}</span><div class="ex-mine__meta">${act('', 'untrust', 'explore.review.untrust', 'button--secondary', `<input type="hidden" name="steam_id" value="${esc(id)}" />`)}</div></li>`).join('')
  return crumbs(lang, tt(lang, 'explore.review.title')) + `<h1>${tt(lang, 'explore.review.title')}</h1><p class="muted">${tt(lang, 'explore.review.intro')}</p>` + accountBar(lang, viewer, here)
    + (error ? `<div class="notice ex-notice-error" role="alert"><p>${esc(error)}</p></div>` : '')
    + (pending.length ? `<ul class="ex-list">${queue}</ul>` : `<p class="panel">${tt(lang, 'explore.review.empty')}</p>`)
    + `<section class="ex-section"><h2>${tt(lang, 'explore.review.trusted')}</h2>${trustedRows ? `<ul class="ex-list">${trustedRows}</ul>` : '<p class="muted">—</p>'}</section>`
    + `<section class="ex-section"><h2>${tt(lang, 'explore.review.live')}</h2>${liveRows ? `<ul class="ex-list">${liveRows}</ul>` : '<p class="muted">—</p>'}</section>`
}
