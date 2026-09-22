/**
 * Whether the player has opted into the beta update line -- the 「参与 Beta 测试」 / "Join the
 * beta" switch in Settings (beta channel design §4).
 *
 * Nothing stored means "follow the build": on by default in a beta build, off in a stable or
 * test build, so a stable player is never offered a beta unless they turn it on, and a beta
 * tester keeps seeing beta offers without having to find the switch first.
 *
 * Storage can be missing or throw, so every access is guarded, exactly as `updates.ts` does.
 */
export const BETA_STORAGE_KEY = 'aimloom.beta'

interface Reader { getItem(key: string): string | null }
interface Writer { setItem(key: string, value: string): void }
export type BetaStorage = (Reader & Writer) | null

/**
 * `defaultOn` is the build's own channel (`channel === 'beta'`), decided by the caller from
 * `installer_app_info` -- this module knows nothing about channels itself. Anything stored other
 * than the literal `'on'` or `'off'`, or storage that throws, falls back to `defaultOn`.
 */
export function readBetaEnabled(storage: Reader | null | undefined, defaultOn: boolean): boolean {
  try {
    const value = storage?.getItem(BETA_STORAGE_KEY)
    if (value === 'on') return true
    if (value === 'off') return false
    return defaultOn
  } catch { return defaultOn }
}

export function writeBetaEnabled(storage: Writer | null | undefined, on: boolean): void {
  try { storage?.setItem(BETA_STORAGE_KEY, on ? 'on' : 'off') }
  catch { /* the choice still holds for this session */ }
}
