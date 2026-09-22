/**
 * Whether the App checks for a newer version when it starts.
 *
 * On by default, and switchable off from Settings: the App is otherwise entirely offline, so a
 * player who wants it to stay that way must be able to say so. The check itself never fails
 * loudly — see `UpdateCheck` in `installer/contracts.ts` — so this switch is about the request
 * being made at all, not about how its answer is shown.
 *
 * Storage can be missing or throw, so every access is guarded; unreadable means the default.
 */
export const UPDATES_STORAGE_KEY = 'aimloom.updates'

interface Reader { getItem(key: string): string | null }
interface Writer { setItem(key: string, value: string): void }
export type UpdatesStorage = (Reader & Writer) | null

/** On unless the player has explicitly turned it off. Anything unreadable means on. */
export function readUpdatesEnabled(storage: Reader | null | undefined): boolean {
  try { return storage?.getItem(UPDATES_STORAGE_KEY) !== 'off' }
  catch { return true }
}

export function writeUpdatesEnabled(storage: Writer | null | undefined, on: boolean): void {
  try { storage?.setItem(UPDATES_STORAGE_KEY, on ? 'on' : 'off') }
  catch { /* the choice still holds for this session */ }
}
