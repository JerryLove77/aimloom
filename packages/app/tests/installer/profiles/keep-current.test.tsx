import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProfilesApp, type ProfileGameBridge } from '../../../src/profiles/ProfilesApp'
import type { ProfileBridge } from '../../../src/profiles/bridge'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { TrainingProfile } from '../../../src/profiles/model'

/**
 * The user on test.5 (2026-09-21): 「profile还是显示具体名字吧，这个保持当前完全不清楚是什么配置」.
 * Wherever a Profile keeps a component, it now says what the game has right now.
 */
const keepsAll = (id: string, name: string): TrainingProfile => ({ schemaVersion: 1, id, name, scheme: null, audio: null })
const soundsOnly = (): TrainingProfile => ({
  schemaVersion: 1, id: 'kills', name: '击杀音效', scheme: null,
  audio: { kill: [{ name: 'pop.wav', path: 'C:/g/sounds/pop.wav' }], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] },
})

function setup(profiles: TrainingProfile[], readable = true) {
  const bridge: ProfileBridge = {
    list: async () => ({ directory: '/profiles', profiles, errors: [] }),
    read: async (id: string) => ({ filePath: `/profiles/${id}.json`, profile: structuredClone(profiles.find(p => p.id === id) ?? null) }),
    save: async profile => ({ filePath: `/profiles/${profile.id}.json`, profile }),
    delete: async () => ({ deleted: true }),
  }
  const assets: ProfileAssetBridge = { chooseDirectory: async () => null, list: async () => ({ directory: '', files: [], errors: [] }), read: async () => new Uint8Array() }
  const refuse = async (): Promise<never> => { throw new Error('the engine refused') }
  const game: ProfileGameBridge = {
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    schemeList: readable ? async () => ({ directory: '', current: '3 AM', themes: [] }) : refuse,
    audioList: readable ? async () => ({ directory: '', sounds: [], bindings: { kill: ['808 perc', 'Anime01'], spawn: [], mbsGood: ['None'], mbsOkay: [], mbsBad: [], mbsChangeNow: [] } }) : refuse,
    pickFolder: async () => null,
    planProfileApply: async input => ({ planId: 'p', revision: input.revision, kind: 'install', location: { gameRoot: input.gameRoot, backupRoot: 'C:/b', gameState: 'closed' }, packRoot: null, categories: ['primary'], sourceId: null, rows: [], skipped: [] }),
    execute: refuse, job: refuse, reconcile: refuse,
    planFileAdd: refuse, pickFile: async () => null,
    launchGame: refuse,
  }
  render(<ProfilesApp bridge={bridge} assets={assets} locate={game} />)
}

describe('「保持当前」 says what it keeps', () => {
  it('in the library row: the current theme and the bound sounds', async () => {
    setup([keepsAll('a', '全保持')])
    expect(await screen.findByText(/Theme · 保持当前 · 3 AM/)).toBeTruthy()
    expect(screen.getByText(/Sounds · 保持当前 · 击杀 808 perc、Anime01/)).toBeTruthy()
  })

  it('never shows the game\'s "None" placeholder as a sound', async () => {
    setup([keepsAll('a', '全保持')])
    await screen.findByText(/保持当前 · 3 AM/)
    expect(screen.queryByText(/None/)).toBeNull()
  })

  it('names recorded sounds instead of counting them, and says how many events stay', async () => {
    setup([soundsOnly()])
    expect(await screen.findByText(/Sounds · 击杀 pop\.wav；其余 5 项保持当前/)).toBeTruthy()
  })

  it('in the apply dialog: every sound event on its own line', async () => {
    setup([soundsOnly()])
    fireEvent.click(await screen.findByRole('button', { name: '应用 击杀音效' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('击杀 pop.wav')
    expect(within(dialog).getByText('生成 保持当前 · 无音效')).toBeTruthy()
    expect(within(dialog).getByText(/Theme · 保持当前 · 3 AM/)).toBeTruthy()
  })

  it('falls back to the bare 「保持当前」 when the game cannot be read', async () => {
    setup([keepsAll('a', '全保持')], false)
    const row = await screen.findByRole('button', { name: /编辑 全保持/ })
    expect(row.textContent).toContain('Theme · 保持当前')
    expect(row.textContent).not.toContain('3 AM')
  })
})
