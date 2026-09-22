import { readCapped, readCappedText } from './body'
import { fail, json, requireClient, requireContentLengthWithin, requireJsonContentType } from './http'

const NAME_MAX = 64, ANSWER_MAX = 64 * 1024, TIMEOUT_MS = 8000, MAX_BODY_BYTES = 4 * 1024

/** The one URL this Worker will fetch for a pasted link, or `null`. Rebuilt from its parts, never passed through. */
export function parseSteamUrl(input: string): string | null {
  let url: URL
  try { url = new URL(input.trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  if (url.hostname !== 'steamcommunity.com' && url.hostname !== 'www.steamcommunity.com') return null
  const match = /^\/(id\/[A-Za-z0-9_-]{1,64}|profiles\/\d{17})\/?$/.exec(url.pathname)
  return match ? `https://steamcommunity.com/${match[1]}/?xml=1` : null
}

export function parseSteamXml(xml: string): { steamId: string; name: string } | 'not-found' | null {
  const steamId = /<steamID64>(\d{17})<\/steamID64>/.exec(xml)?.[1]
  const name = /<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/.exec(xml)?.[1]
  // A parsable profile wins: a player may be NAMED "<error>". Steam's error document has no steamID64 at all.
  if (steamId !== undefined && name !== undefined) return { steamId, name: [...name.trim()].slice(0, NAME_MAX).join('') }
  return /<error>/.test(xml) ? 'not-found' : null
}

/** The App talks only to aimloom.dev; this reads the profile's public XML view, which needs no key (spec §5.3). */
export async function handleSteamResolve(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405)
  const badType = requireJsonContentType(request); if (badType) return badType
  const badClient = requireClient(request); if (badClient) return badClient
  const tooLarge = requireContentLengthWithin(request, MAX_BODY_BYTES); if (tooLarge) return tooLarge
  let capped: { bytes: Uint8Array; truncated: boolean }
  try { capped = await readCapped(request, MAX_BODY_BYTES) } catch { return fail('INVALID_STEAM_URL', 400) }
  if (capped.truncated) return fail('TOO_LARGE', 413)
  let body: unknown
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(capped.bytes)) } catch { return fail('INVALID_STEAM_URL', 400) }
  const link = typeof body === 'object' && body !== null && typeof (body as { url?: unknown }).url === 'string' ? (body as { url: string }).url : ''
  const target = parseSteamUrl(link)
  if (target === null) return fail('INVALID_STEAM_URL', 400)
  let xml: string
  try {
    // Never follow a redirect: the only URL this Worker fetches is the one it built. Steam's XML view answers 200 directly.
    const answer = await fetcher(target, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'aimloom.dev profile resolver' }, redirect: 'manual' })
    if (!answer.ok) return fail('STEAM_UNREACHABLE', 502)
    xml = await readCappedText(answer, ANSWER_MAX)
  } catch { return fail('STEAM_UNREACHABLE', 502) }
  const parsed = parseSteamXml(xml)
  if (parsed === 'not-found') return fail('STEAM_NOT_FOUND', 404)
  return parsed === null ? fail('STEAM_UNREACHABLE', 502) : json(parsed)
}
