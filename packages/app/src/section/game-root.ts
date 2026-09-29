/**
 * The game folder, remembered across sections and across launches.
 *
 * Theme, Sounds, Crosshair and Enemy each discover the game independently, and before this
 * existed none of them told the others what they found. On a machine where auto-discovery
 * fails -- a Steam library nested somewhere the engine cannot guess -- that made the player
 * find the same folder once per section, and made one section look broken while its neighbour
 * looked fine. A folder the player has already pointed at is remembered here.
 *
 * This is a convenience, never an authority: the stored string is whatever was last accepted,
 * it can be stale (an uninstalled game, an unplugged drive), and every use must go back through
 * `locate` before anything is read or written. Storage can be missing or throw -- in a private
 * window, with site data blocked, during a thumbnail capture -- so every access is guarded and
 * an unreadable value simply means "nothing remembered".
 */
export const GAME_ROOT_STORAGE_KEY = 'aimloom.gameRoot'

interface Reader { getItem(key: string): string | null }
interface Writer { setItem(key: string, value: string): void; removeItem(key: string): void }
/** What a section holds on to: localStorage in the App, a fake in tests, null where there is none. */
export type GameRootStorage = (Reader & Writer) | null

/** The remembered folder, or `null` when there is none or it cannot be trusted as a path. */
export function readGameRoot(storage: Reader | null | undefined): string | null {
  try {
    const value = storage?.getItem(GAME_ROOT_STORAGE_KEY)
    return typeof value === 'string' && isPlausibleRoot(value) ? value : null
  } catch { return null }
}

/** Remembers a folder, or forgets it when given `null`. Failure is silent and harmless. */
export function writeGameRoot(storage: Writer | null | undefined, root: string | null): void {
  try {
    if (root === null) storage?.removeItem(GAME_ROOT_STORAGE_KEY)
    else if (isPlausibleRoot(root)) storage?.setItem(GAME_ROOT_STORAGE_KEY, root)
  } catch { /* the folder still holds for this session */ }
}

/**
 * A cheap shape check, not validation. It exists so a corrupt or hostile stored value cannot be
 * handed to the native layer at all; the engine remains the only thing that decides whether a
 * folder is really a KovaaK install. Rejects the empty string, anything with a line break or a
 * NUL, anything absurdly long, and anything that is not an absolute Windows path.
 */
function isPlausibleRoot(value: string): boolean {
  if (!value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) return false
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\/]/.test(value)
}

/**
 * Where the game keeps each kind of file, under a game folder the engine has already validated.
 *
 * This is for *offering* a starting folder, never for writing: the engine owns every path it
 * touches (`Get-KvkTargetPath`), and these strings only decide which folder a picker opens on.
 * Themes and enemy looks are both theme JSONs, so they share one folder.
 */
export function gameAssetFolder(kind: 'scheme' | 'enemy' | 'audio', gameRoot: string): string {
  const separator = gameRoot.includes('\\') ? '\\' : '/'
  const parts = kind === 'audio'
    ? ['FPSAimTrainer', 'sounds']
    : ['FPSAimTrainer', 'Saved', 'SaveGames', 'Themes']
  return [gameRoot.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

/** The part of a section's bridge this needs. Every section's bridge already has both. */
export interface LocateBridge {
  discover(): Promise<{ candidates: string[] }>
  locate(gameRoot: string): Promise<{ gameRoot: string }>
}

/**
 * Which folder a section should load, and what to offer if there is no single answer.
 *
 * A remembered folder wins, but only if it still resolves -- the game can be uninstalled, moved,
 * or sit on a drive that is not plugged in, and a stale string must never turn into an error the
 * player has to understand. When it no longer resolves this falls back to discovery exactly as
 * if nothing had been remembered, and forgets it so the next launch does not retry it.
 *
 * Discovery's own failures are NOT swallowed: those are the engine refusing, and the section
 * shows them. `gameRoot` is null when the player still has to choose, and `candidates` is what
 * to offer them.
 */
export async function resolveGameRoot(
  bridge: LocateBridge,
  storage: GameRootStorage | undefined,
): Promise<{ gameRoot: string | null; candidates: string[] }> {
  const remembered = readGameRoot(storage)
  if (remembered !== null) {
    try {
      const located = await bridge.locate(remembered)
      writeGameRoot(storage, located.gameRoot)
      return { gameRoot: located.gameRoot, candidates: [located.gameRoot] }
    } catch { writeGameRoot(storage, null) }
  }
  const discovery = await bridge.discover()
  const candidates = discovery.candidates
  if (candidates.length !== 1) return { gameRoot: null, candidates }
  const located = await bridge.locate(candidates[0]!)
  writeGameRoot(storage, located.gameRoot)
  return { gameRoot: located.gameRoot, candidates }
}
