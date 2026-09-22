import { describe, expect, it } from 'vitest'
import { GAME_ROOT_STORAGE_KEY, readGameRoot, resolveGameRoot, writeGameRoot } from '../../../src/workspace/game-root'

/** A minimal store that behaves like localStorage, plus one that fails the way a blocked one does. */
function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
  }
}
const throwing = {
  getItem() { throw new DOMException('blocked') },
  setItem() { throw new DOMException('blocked') },
  removeItem() { throw new DOMException('blocked') },
}

describe('the remembered game folder', () => {
  it('round-trips a Windows path under the documented key', () => {
    const s = store()
    writeGameRoot(s, 'D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer')
    expect(s.map.get(GAME_ROOT_STORAGE_KEY)).toBe('D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer')
    expect(readGameRoot(s)).toBe('D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer')
  })

  it('remembers a UNC path and a non-ASCII folder', () => {
    const s = store()
    writeGameRoot(s, '\\\\nas\\games\\FPSAimTrainer')
    expect(readGameRoot(s)).toBe('\\\\nas\\games\\FPSAimTrainer')
    writeGameRoot(s, 'D:\\游戏库\\steamapps\\common\\FPSAimTrainer')
    expect(readGameRoot(s)).toBe('D:\\游戏库\\steamapps\\common\\FPSAimTrainer')
  })

  it('forgets on null, and reads nothing when nothing was stored', () => {
    const s = store()
    expect(readGameRoot(s)).toBeNull()
    writeGameRoot(s, 'C:\\Games\\FPSAimTrainer')
    writeGameRoot(s, null)
    expect(s.map.has(GAME_ROOT_STORAGE_KEY)).toBe(false)
    expect(readGameRoot(s)).toBeNull()
  })

  it('refuses a value that was never a path, however it got into storage', () => {
    // A corrupt or hostile stored value must never reach the native layer.
    for (const bad of ['', '   ', 'relative\\path', '/etc/passwd', 'C:', 'http://evil.test/x',
      'C:\\ok\0\\nul', 'C:\\ok\nD:\\other', 'C:\\' + 'x'.repeat(5000)]) {
      expect(readGameRoot(store({ [GAME_ROOT_STORAGE_KEY]: bad })), bad).toBeNull()
    }
  })

  it('refuses to store a value it would refuse to read back', () => {
    const s = store()
    writeGameRoot(s, 'not a path')
    expect(s.map.has(GAME_ROOT_STORAGE_KEY)).toBe(false)
  })

  it('treats storage that throws, and no storage at all, as nothing remembered', () => {
    expect(readGameRoot(throwing)).toBeNull()
    expect(readGameRoot(null)).toBeNull()
    expect(readGameRoot(undefined)).toBeNull()
    // Writing must stay silent: the section keeps working for this session either way.
    expect(() => writeGameRoot(throwing, 'C:\\Games\\FPSAimTrainer')).not.toThrow()
    expect(() => writeGameRoot(throwing, null)).not.toThrow()
    expect(() => writeGameRoot(null, 'C:\\Games\\FPSAimTrainer')).not.toThrow()
  })
})

describe('choosing which folder a section loads', () => {
  const GAME = 'D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer'
  const OTHER = 'E:\\Games\\FPSAimTrainer'
  function bridge(opts: { candidates?: string[]; locatable?: string[]; discoverThrows?: boolean } = {}) {
    const calls: string[] = []
    return {
      calls,
      discover: async () => {
        calls.push('discover')
        if (opts.discoverThrows) throw new Error('engine refused')
        return { candidates: opts.candidates ?? [] }
      },
      locate: async (root: string) => {
        calls.push(`locate:${root}`)
        if (opts.locatable && !opts.locatable.includes(root)) throw new Error('not a game folder')
        return { gameRoot: root }
      },
    }
  }

  it('uses the remembered folder without asking discovery at all', async () => {
    const b = bridge({ locatable: [GAME] })
    const result = await resolveGameRoot(b, store({ [GAME_ROOT_STORAGE_KEY]: GAME }))
    expect(result).toEqual({ gameRoot: GAME, candidates: [GAME] })
    expect(b.calls).toEqual([`locate:${GAME}`])
  })

  it('falls back to discovery when the remembered folder no longer resolves, and forgets it', async () => {
    // The game was uninstalled, or the drive is not plugged in. The player must not see an error.
    const s = store({ [GAME_ROOT_STORAGE_KEY]: OTHER })
    const b = bridge({ candidates: [GAME], locatable: [GAME] })
    const result = await resolveGameRoot(b, s)
    expect(result).toEqual({ gameRoot: GAME, candidates: [GAME] })
    expect(b.calls).toEqual([`locate:${OTHER}`, 'discover', `locate:${GAME}`])
    expect(s.map.get(GAME_ROOT_STORAGE_KEY)).toBe(GAME)
  })

  it('remembers what discovery found, so the next section does not ask again', async () => {
    const s = store()
    await resolveGameRoot(bridge({ candidates: [GAME], locatable: [GAME] }), s)
    expect(s.map.get(GAME_ROOT_STORAGE_KEY)).toBe(GAME)
  })

  it('remembers nothing and answers null when the player still has to choose', async () => {
    const s = store()
    for (const candidates of [[], [GAME, OTHER]]) {
      const result = await resolveGameRoot(bridge({ candidates }), s)
      expect(result).toEqual({ gameRoot: null, candidates })
      expect(s.map.has(GAME_ROOT_STORAGE_KEY)).toBe(false)
    }
  })

  it('lets a discovery failure through, because that is the engine speaking', async () => {
    await expect(resolveGameRoot(bridge({ discoverThrows: true }), store())).rejects.toThrow('engine refused')
  })

  it('works with no storage at all, falling straight through to discovery', async () => {
    const b = bridge({ candidates: [GAME], locatable: [GAME] })
    expect(await resolveGameRoot(b, null)).toEqual({ gameRoot: GAME, candidates: [GAME] })
    expect(b.calls).toEqual(['discover', `locate:${GAME}`])
  })
})
