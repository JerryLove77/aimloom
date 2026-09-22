import { clientKey, type AppEnv, type RateLimit } from './env'
import { fail } from './http'
import { handleReport, deleteExpired } from './reports'
import { handleSteamResolve } from './steam'
import { notify } from './notify'

/** `null` lets the request through. The address is the key and is written nowhere (spec §5.4). */
export async function limited(limit: RateLimit, request: Request, failOpen: boolean): Promise<Response | null> {
  let success = failOpen
  try { ({ success } = await limit.limit({ key: clientKey(request) })) } catch {
    // Reports fail open: the ceilings in the database are the real limits, and a client cannot make the binding fail.
    // The Steam route fails closed: it is an outbound fetch with nothing behind it. Either way, say so, without the address.
    console.warn(`rate limiter unavailable; ${failOpen ? 'letting the request through' : 'refusing the request'}`)
  }
  return success ? null : fail('RATE_LIMITED', 429)
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    // Only /api/* runs this script first (wrangler.jsonc). Anything else that reaches it matched no
    // static asset, so the asset handler answers with the site's 404 page.
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    if (pathname === '/api/reports') return (await limited(env.REPORT_LIMIT, request, true)) ?? handleReport(request, env, ctx, { afterStore: notify })
    if (pathname === '/api/steam/resolve') return (await limited(env.STEAM_LIMIT, request, false)) ?? handleSteamResolve(request)
    return fail('NOT_FOUND', 404)
  },
  // The Cron Trigger (wrangler.jsonc's top-level `triggers`, inherited by every environment) is what
  // keeps the Privacy page's "deleted after 180 days" true even in a week with no reports at all;
  // the request-path DELETE in reports.ts only prunes when something new arrives.
  async scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(deleteExpired(env, new Date()))
  },
} satisfies ExportedHandler<AppEnv>
