/**
 * The player's Steam account, as they confirmed it, kept in the App's own storage.
 *
 * Steam *is* the account: there is no password, no server-side account table, and nothing here
 * is a credential. The App holds a SteamID and a display name so a report can say who sent it
 * without asking again. Verification is required for exactly one thing — uploading a
 * configuration to the explorer — and it is not this. Nothing stored here is ever treated as
 * proof of anything; the backend re-resolves and decides.
 *
 * Storage can be missing or throw, so every access is guarded and an unreadable value simply
 * means "no account".
 */
export const ACCOUNT_STORAGE_KEY = 'aimloom.account'

interface Reader { getItem(key: string): string | null }
interface Writer { setItem(key: string, value: string): void; removeItem(key: string): void }
export type AccountStorage = (Reader & Writer) | null

export interface Account { steamId: string; name: string }

/** A SteamID64 is exactly 17 digits and starts with a 7. Anything else was never one. */
const STEAM_ID = /^7[0-9]{16}$/
const MAX_NAME = 64

function valid(value: unknown): value is Account {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const { steamId, name } = record
  if (Object.keys(record).length !== 2) return false
  if (typeof steamId !== 'string' || !STEAM_ID.test(steamId)) return false
  // A Steam display name can be anything a player typed, in any script -- it is shown, never
  // parsed. Only a line break or a NUL is refused, because those break every log and message
  // that will carry it.
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME && !/[\0\r\n]/.test(name)
}

/** The stored account, or `null` when there is none or it is not the shape it should be. */
export function readAccount(storage: Reader | null | undefined): Account | null {
  try {
    const raw = storage?.getItem(ACCOUNT_STORAGE_KEY)
    if (typeof raw !== 'string') return null
    const parsed: unknown = JSON.parse(raw)
    return valid(parsed) ? { steamId: parsed.steamId, name: parsed.name } : null
  } catch { return null }
}

/** Stores an account, or forgets it when given `null`. A value it would refuse to read is not stored. */
export function writeAccount(storage: Writer | null | undefined, account: Account | null): void {
  try {
    if (account === null) storage?.removeItem(ACCOUNT_STORAGE_KEY)
    else if (valid(account)) storage?.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ steamId: account.steamId, name: account.name }))
  } catch { /* the account still holds for this session */ }
}

/**
 * The UI's own cheap check before it asks the backend to resolve a pasted link. The backend
 * remains the authority — this only stops an obviously wrong paste from becoming a network
 * call and a confusing error. Both public profile forms are accepted, on Steam's host only.
 */
export function looksLikeSteamUrl(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 2048) return false
  let url: URL
  try { url = new URL(trimmed) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  if (host !== 'steamcommunity.com' && host !== 'www.steamcommunity.com') return false
  const match = /^\/(id|profiles)\/([^/]+)\/?$/.exec(url.pathname)
  if (!match) return false
  const [, kind, value] = match
  const name = decodeURIComponent(value ?? '')
  return kind === 'profiles' ? STEAM_ID.test(name) : name.length > 0
}
