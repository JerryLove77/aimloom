/**
 * Sign in through Steam (OpenID 2.0) and the session it produces (spec 2026-09-22 §11.2). Steam
 * is asked for nothing but the SteamID: the callback's `claimed_id` is verified with Steam
 * server-to-server, and the database keeps only the session token's SHA-256, the SteamID and an
 * expiry. Nothing else on the site needs this.
 */
import type { AppEnv } from './env'
import { fail } from './http'

export const STEAM_OPENID = 'https://steamcommunity.com/openid/login'
export const COOKIE = 'aimloom_session'
export const SESSION_DAYS = 30
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/

export interface Session { steamId: string }
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
async function tokenHash(token: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))) }

/** Only a same-site relative path may be returned to after sign-in. */
export function safeNext(value: string | null): string {
  return value && /^\/(zh|en)\/[a-z0-9/_?=&.%-]*$/i.test(value) && !value.includes('//') ? value : '/zh/explore/'
}

export function loginRedirect(url: URL): Response {
  const next = safeNext(url.searchParams.get('next'))
  const returnTo = new URL('/auth/steam/callback', url.origin); returnTo.searchParams.set('next', next)
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo.toString(), 'openid.realm': url.origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  })
  return Response.redirect(`${STEAM_OPENID}?${p}`, 302)
}

/** Asks Steam whether the signed answer is genuine; returns the SteamID64 or null. */
export async function verifyCallback(url: URL, fetcher: Fetcher): Promise<string | null> {
  const q = url.searchParams
  const claimed = q.get('openid.claimed_id') ?? ''
  const m = CLAIMED.exec(claimed)
  const returnTo = q.get('openid.return_to') ?? ''
  if (!m || q.get('openid.mode') !== 'id_res' || !returnTo.startsWith(`${url.origin}/auth/steam/callback`)) return null
  const check = new URLSearchParams()
  for (const [k, v] of q) if (k.startsWith('openid.')) check.set(k, v)
  check.set('openid.mode', 'check_authentication')
  try {
    const r = await fetcher(STEAM_OPENID, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: check.toString() })
    if (!r.ok) return null
    const text = await r.text()
    return /^is_valid:\s*true$/m.test(text) ? m[1]! : null
  } catch { return null }
}

export async function createSession(env: AppEnv, steamId: string, now: Date): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer)
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  await env.DB.prepare('INSERT INTO session (token_hash, steam_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await tokenHash(token), steamId, now.toISOString(), expires.toISOString()).run()
  return token
}

export function cookieOf(request: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})(?:;|$)`).exec(request.headers.get('cookie') ?? '')
  return m ? m[1]! : null
}

export async function readSession(request: Request, env: AppEnv, now: Date): Promise<Session | null> {
  const token = cookieOf(request)
  if (!token) return null
  const row = await env.DB.prepare('SELECT steam_id, expires_at FROM session WHERE token_hash = ?').bind(await tokenHash(token)).first<{ steam_id: string; expires_at: string }>()
  return row && row.expires_at > now.toISOString() ? { steamId: row.steam_id } : null
}

export async function deleteSession(request: Request, env: AppEnv): Promise<void> {
  const token = cookieOf(request)
  if (token) await env.DB.prepare('DELETE FROM session WHERE token_hash = ?').bind(await tokenHash(token)).run()
}

export const setCookie = (token: string): string => `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`
export const clearCookie = (): string => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`

/** Every state-changing request must come from the site's own origin. */
export function requireSameOrigin(request: Request): Response | null {
  return request.headers.get('origin') === new URL(request.url).origin ? null : fail('FORBIDDEN', 403)
}

export function isAdmin(env: AppEnv, steamId: string): boolean {
  return (env.ADMIN_STEAM_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(steamId)
}

/** `/auth/*`: login, callback, sign-out. `null` for other paths. */
export async function handleAuth(request: Request, env: AppEnv, now: Date, fetcher: Fetcher = fetch): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname === '/auth/steam/login') {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405)
    return loginRedirect(url)
  }
  if (url.pathname === '/auth/steam/callback') {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405)
    const steamId = await verifyCallback(url, fetcher)
    const next = safeNext(url.searchParams.get('next'))
    if (!steamId) return Response.redirect(new URL(next + (next.includes('?') ? '&' : '?') + 'signin=failed', url.origin).toString(), 302)
    const token = await createSession(env, steamId, now)
    // A first sign-in goes through "pick a name" (the display name belongs to the account), then on to `next`.
    const named = await env.DB.prepare('SELECT display_name FROM creator WHERE steam_id = ?').bind(steamId).first<string | null>('display_name')
    const lang = next.startsWith('/en/') ? 'en' : 'zh'
    const to = named ? next : `/${lang}/explore/welcome/?next=${encodeURIComponent(next)}`
    return new Response(null, { status: 302, headers: { location: new URL(to, url.origin).toString(), 'set-cookie': setCookie(token), 'cache-control': 'no-store' } })
  }
  if (url.pathname === '/auth/signout') {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
    const refused = requireSameOrigin(request); if (refused) return refused
    await deleteSession(request, env)
    const next = safeNext(new URL(request.url).searchParams.get('next'))
    return new Response(null, { status: 303, headers: { location: new URL(next, url.origin).toString(), 'set-cookie': clearCookie(), 'cache-control': 'no-store' } })
  }
  return null
}
