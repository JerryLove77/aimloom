import type { AudioBindings } from '../installer/contracts'

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
}

export interface CurrentGameBridge {
  schemeList(gameRoot: string): Promise<{ current: string | null }>
  audioList(gameRoot: string): Promise<{ bindings: AudioBindings }>
}

export async function readCurrentGame(bridge: CurrentGameBridge, gameRoot: string): Promise<CurrentGame> {
  const [scheme, audio] = await Promise.allSettled([bridge.schemeList(gameRoot), bridge.audioList(gameRoot)])
  return {
    theme: scheme.status === 'fulfilled' ? scheme.value.current : null,
    sounds: audio.status === 'fulfilled' ? audio.value.bindings : null,
  }
}
