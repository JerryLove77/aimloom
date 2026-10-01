import { AUDIO_EVENTS, type AudioBindings } from '../bridge/contracts'
import { SINGLE_SOUND_EVENTS, type ProfileAudio, type ProfileFileReference, type TrainingProfile } from './model'

/**
 * What the game is set to right now: what a new Profile starts from (`snapshotFromGame`) and what
 * 当前使用 compares against (`profileInUse`). Each part is best effort and independent: a part
 * that cannot be read is null, and then nothing is taken from it and no Profile reads as in use.
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

interface InstalledEntry { name: string | null; path: string; file?: string; duplicateName?: boolean; ambiguous?: boolean }

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

/** The file name at the end of a path, for a Profile reference's `name`. */
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** The one installed entry with this name, or null when there is none or more than one. */
function unique(entries: InstalledEntry[] | null | undefined, name: string): InstalledEntry | null {
  const found = (entries ?? []).filter(entry => sameName(entry.name, name))
  const only = found.length === 1 ? found[0]! : null
  return only && !only.duplicateName && !only.ambiguous ? only : null
}
const reference = (entry: InstalledEntry): ProfileFileReference => ({ name: entry.file ?? fileName(entry.path), path: entry.path })

/**
 * A new Profile starts as the game is now (user, 2026-09-30: 「创建 profile 时候默认是当前的设置」).
 * Each part the game names is resolved to the one installed file with that name; a part that
 * cannot be resolved (nothing read, no such file, or two files with the name) is left unchosen,
 * and the player picks it before saving. An empty kill or spawn list is kept: it is "no sound".
 * An MBS event holds exactly one sound, so one the game leaves empty (or a settings file that
 * could not be read) is left unchosen too, never recorded as an empty list.
 */
export function snapshotFromGame(current: CurrentGame | null): { theme: ProfileFileReference | null; audio: ProfileAudio } {
  const audio: ProfileAudio = {}
  if (!current) return { theme: null, audio }
  const theme = current.theme ? unique(current.installedThemes, current.theme) : null
  for (const event of AUDIO_EVENTS) {
    const bound = current.sounds?.[event]
    if (!bound) continue
    if (SINGLE_SOUND_EVENTS.includes(event) && bound.length !== 1) continue
    const files = bound.map(name => unique(current.installedSounds, name))
    if (files.every(entry => entry !== null)) audio[event] = files.map(entry => reference(entry!))
  }
  return { theme: theme ? reference(theme) : null, audio }
}

/**
 * Whether the game is set to exactly what this Profile records, so its row says 「当前使用」.
 * The same resolution `planProfileApply` performs (`engine/settings.rs`): each recorded path
 * is matched to an installed file by full path, case-insensitive, and that file's name is what
 * the game would hold. Every part is compared, the theme and all six events, an empty list
 * included. Unknown parts of the game (a list that could not be read, a path no longer
 * installed) mean "not in use".
 */
export function profileInUse(profile: TrainingProfile, current: CurrentGame | null): boolean {
  if (!current || !profile.theme) return false
  const theme = current.installedThemes?.find(entry => samePath(entry.path, profile.theme!.path))
  if (!theme || !sameName(theme.name, current.theme)) return false
  return AUDIO_EVENTS.every(event => {
    const records = profile.audio[event]
    const bound = current.sounds?.[event]
    if (!records || !bound || bound.length !== records.length) return false
    return records.every((record, index) => {
      const entry = current.installedSounds?.find(sound => samePath(sound.path, record.path))
      return !!entry && sameName(entry.name, bound[index])
    })
  })
}
