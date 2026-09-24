import type { AppEnv } from './env'

/** Cloudflare Turnstile's server-side check, for uploads and tickets. No IP is sent: only the widget's token. */
export async function humanCheck(env: AppEnv, token: string, fetcher: typeof fetch): Promise<boolean> {
  if (!token || !env.TURNSTILE_SECRET) return false
  try {
    const r = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }) })
    return r.ok && (await r.json() as { success?: unknown }).success === true
  } catch { return false }
}

/** The widget's public key, or null while either key is missing: then uploads and tickets stay closed. */
export const turnstileSiteKey = (env: AppEnv): string | null => (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET ? env.TURNSTILE_SITE_KEY : null)
