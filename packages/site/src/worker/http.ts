import { readCapped } from './body'

export type ErrorCode =
  | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'UNSUPPORTED_MEDIA_TYPE' | 'TOO_LARGE' | 'INVALID_JSON' | 'INVALID_REPORT'
  | 'UNKNOWN_CLIENT' | 'RATE_LIMITED' | 'DAILY_LIMIT' | 'STORAGE_FULL' | 'STORAGE_FAILED'
  | 'INVALID_STEAM_URL' | 'STEAM_NOT_FOUND' | 'STEAM_UNREACHABLE'
  | 'FORBIDDEN' | 'UNAUTHORIZED'
  | 'INVALID_TICKET' | 'HUMAN_CHECK_FAILED' | 'TICKETS_CLOSED'

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: HEADERS })
export const fail = (code: ErrorCode, status: number, extra: Record<string, string> = {}): Response => json({ code, ...extra }, status)

/** Both API routes require the App to name itself; this is Cloudflare's egress otherwise. */
const CLIENT = /^Aimloom\/\d+\.\d+\.\d+/
export function requireClient(request: Request): Response | null {
  return CLIENT.test(request.headers.get('user-agent') ?? '') ? null : fail('UNKNOWN_CLIENT', 400)
}

export function requireJsonContentType(request: Request): Response | null {
  return (request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json') ? null : fail('UNSUPPORTED_MEDIA_TYPE', 415)
}

/** Refuses a request whose declared `content-length` already exceeds `max`, before any body read starts. */
export function requireContentLengthWithin(request: Request, max: number): Response | null {
  const contentLength = request.headers.get('content-length')
  return contentLength !== null && Number(contentLength) > max ? fail('TOO_LARGE', 413) : null
}

/**
 * The JSON body of a request, read at most `max` bytes: a declared or actual size over `max` is
 * TOO_LARGE, and a body that is not UTF-8 JSON answers `invalid`, the route's own code for it.
 */
export async function readJsonBody(request: Request, max: number, invalid: ErrorCode): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const tooLarge = requireContentLengthWithin(request, max); if (tooLarge) return { ok: false, response: tooLarge }
  let capped: { bytes: Uint8Array; truncated: boolean }
  try { capped = await readCapped(request, max) } catch { return { ok: false, response: fail(invalid, 400) } }
  if (capped.truncated) return { ok: false, response: fail('TOO_LARGE', 413) }
  try { return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(capped.bytes)) } } catch { return { ok: false, response: fail(invalid, 400) } }
}
