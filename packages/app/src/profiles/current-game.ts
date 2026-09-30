import type { AudioBindings, AudioEvent } from '../bridge/contracts'
import type { TrainingProfile } from './model'

/**
 * What the game is set to right now, so that 「保持当前」 can say what it keeps. Each part is
 * best effort and independent: a part that cannot be read is null, and the UI then falls back to
 * the bare 「保持当前」 it showed before (2026-09-21, the user: 「保持当前完全不清楚是什么配置」).
 *
 * A Profile no longer manages the enemy (2026-09-21), so this no longer reads it: `keptEnemy`,
 * `enemyList` and the swatch helpers went with it.
 */
export interface CurrentGame {
  /** The theme name the settings file records, or null when unknown. */
  theme: string | null
  sounds: AudioBindings | null
  /** The installed themes and sounds, by name and full path: what a Profile's paths resolve to. */
  installedThemes?: InstalledEntry[] | null
  installedSounds?: InstalledEntry[] | null
}

interface InstalledEntry { name: string | null; path: string }

export interface CurrentGameBridge {
  schemeList(gameRoot: string): Promise<{ current: string | null; themes?: InstalledEntry[] }>
  audioList(gameRoot: string): Promise<{ bindings: AudioBindings; sounds?: InstalledEntry[] }>
}

export async function readCurrentGame(bridge: CurrentGameBridge, gameRoot: string): Promise<CurrentGame> {
  const [scheme, audio] = await Promise.allSettled([bridge.schemeList(gameRoot), bridge.audioList(gameRoot)])
  return {
    theme: scheme.status === 'fulfilled' ? scheme.value.current : null,
    sounds: audio.status === 'fulfilled' ? audio.value.bindings : null,
    installedThemes: scheme.status === 'fulfilled' ? scheme.value.themes ?? null : null,
    installedSounds: audio.status === 'fulfilled' ? audio.value.sounds ?? null : null,
  }
}

const samePath = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()
const sameName = (a: string | null | undefined, b: string | null | undefined) => a != null && b != null && a.toLowerCase() === b.toLowerCase()

/**
 * Whether the game is set to exactly what this Profile records, so its row says 「当前使用」.
 * The same resolution `planProfileApply` performs (`kvk-profile-apply.ps1`): each recorded path
 * is matched to an installed file by full path, case-insensitive, and that file's name is what
 * the game would hold. A kept part (no theme, an empty or absent event) is not compared, so a
 * Profile that keeps everything is never "in use" -- it has nothing to apply. Unknown parts of
 * the game (a list that could not be read, a path no longer installed) mean "not in use".
 */
export function profileInUse(profile: TrainingProfile, current: CurrentGame | null): boolean {
  if (!current) return false
  let compared = false
  if (profile.scheme) {
    const entry = current.installedThemes?.find(theme => samePath(theme.path, profile.scheme!.path))
    if (!entry || !sameName(entry.name, current.theme)) return false
    compared = true
  }
  for (const event of Object.keys(profile.audio ?? {}) as AudioEvent[]) {
    const records = profile.audio?.[event]
    if (!records || records.length === 0) continue
    const bound = current.sounds?.[event]
    if (!bound || bound.length !== records.length) return false
    for (const [index, record] of records.entries()) {
      const entry = current.installedSounds?.find(sound => samePath(sound.path, record.path))
      if (!entry || !sameName(entry.name, bound[index])) return false
    }
    compared = true
  }
  return compared
}
