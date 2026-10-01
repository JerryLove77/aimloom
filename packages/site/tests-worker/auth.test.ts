import { env as testEnv } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { handleAuth, readSession } from '../src/worker/auth'
import type { AppEnv } from '../src/worker/env'

const env = testEnv as unknown as AppEnv
const origin = 'https://aimloom.dev'
const now = new Date('2026-10-01T12:00:00Z')
const steamId = '76561198000000042'
const stateCookie = '__Host-aimloom_login'
const confirmed = async () => new Response('is_valid:true\n')

async function flow() {
  const response = (await handleAuth(new Request(`${origin}/auth/steam/login?next=/en/explore/`), env, now))!
  const returnTo = new URL(response.headers.get('location')!).searchParams.get('openid.return_to')!
  const callback = new URL(returnTo)
  const fields = {
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res',
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.return_to': returnTo,
    'openid.response_nonce': `${now.toISOString()}test`, 'openid.sig': 'test-signature',
    'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce',
  }
  for (const [key, value] of Object.entries(fields)) callback.searchParams.set(key, value)
  return { response, callback, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' }
}

describe('Steam login browser binding', () => {
  it('issues a fresh secure browser challenge for each login', async () => {
    const a = await flow(), b = await flow()
    expect(a.callback.searchParams.get('state')).toMatch(/^[0-9a-f]{64}$/)
    expect(a.cookie).toBe(`${stateCookie}=${a.callback.searchParams.get('state')}`)
    expect(a.cookie).not.toBe(b.cookie)
    expect(a.response.headers.get('set-cookie')).toContain('Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax')
    expect(a.response.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['missing cookie', 'different browser', 'changed next', 'changed state', 'changed return_to', 'unsigned return_to', 'duplicate identity'])('refuses %s even with a genuine Steam answer', async kind => {
    const login = await flow()
    let cookie = login.cookie
    if (kind === 'missing cookie') cookie = ''
    if (kind === 'different browser') cookie = `${stateCookie}=${'a'.repeat(64)}`
    if (kind === 'changed next') login.callback.searchParams.set('next', '/en/explore/upload/')
    if (kind === 'changed state') login.callback.searchParams.set('state', 'b'.repeat(64))
    if (kind === 'changed return_to') login.callback.searchParams.set('openid.return_to', `${origin}/auth/steam/callback-extra`)
    if (kind === 'unsigned return_to') login.callback.searchParams.set('openid.signed', 'op_endpoint,claimed_id,identity,response_nonce')
    if (kind === 'duplicate identity') login.callback.searchParams.append('openid.claimed_id', `https://steamcommunity.com/openid/id/${steamId}`)
    const response = (await handleAuth(new Request(login.callback, { headers: { cookie } }), env, now, confirmed))!
    expect(response.headers.get('location')).toContain('signin=failed')
    expect(response.headers.get('set-cookie')).not.toContain('aimloom_session=')
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM session').first<number>('n')).toBe(0)
  })

  it('signs in the initiating browser and clears its challenge', async () => {
    const login = await flow()
    const response = (await handleAuth(new Request(login.callback, { headers: { cookie: login.cookie } }), env, now, confirmed))!
    const cookies = response.headers.getSetCookie()
    const session = cookies.find(cookie => cookie.startsWith('aimloom_session='))!
    expect(session).toBeDefined()
    expect(cookies).toContain(`${stateCookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`)
    expect(await readSession(new Request(origin, { headers: { cookie: session.split(';')[0]! } }), env, now)).toEqual({ steamId })
  })
})
