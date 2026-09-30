import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProfilesApp, type ProfileGameBridge } from '../../../src/profiles/ProfilesApp'
import { profileInUse, snapshotFromGame, type CurrentGame } from '../../../src/profiles/current-game'
import type { ProfileBridge } from '../../../src/bridge/profiles'
import type { ProfileAssetBridge } from '../../../src/bridge/assets'
import type { AudioBindings } from '../../../src/bridge/contracts'
import { createProfileDraft, type ProfileAudio, type ProfileFileReference, type TrainingProfile } from '../../../src/profiles/model'

/**
 * The user on test.200 (2026-09-30): after applying "tracking", its 应用 stayed bright, which read
 * as "some other Profile is in use". A row now says 当前使用 when the game holds exactly what it
 * records. Since the same day a Profile is a complete snapshot, and a new one starts as the game is.
 */
const THEMES = 'D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\Themes\\'
const SOUNDS = 'D:\\Game\\FPSAimTrainer\\sounds\\'
const themes = [
  { name: 'clover', file: 'clover bubbles.json', path: `${THEMES}clover bubbles.json`, readable: true, duplicateName: false },
  { name: 'Clean Dark', file: 'Clean Dark.json', path: `${THEMES}Clean Dark.json`, readable: true, duplicateName: false },
]
const sounds = ['Bubble pop 4.ogg', 'Bell5.ogg', 'none.ogg', 'spawn05.ogg'].map(file => ({ name: file.replace(/\.ogg$/, ''), file, path: `${SOUNDS}${file}`, ambiguous: false }))
const bindings: AudioBindings = { kill: ['Bubble pop 4'], spawn: [], mbsGood: ['None'], mbsOkay: ['None'], mbsBad: ['None'], mbsChangeNow: ['spawn05'] }
const game: CurrentGame = { theme: 'clover', sounds: bindings, installedThemes: themes, installedSounds: sounds }
// A recorded path as the Profile sheet writes it; the engine compares full paths ignoring case.
const theme = (file: string): ProfileFileReference => ({ name: file, path: `d:/game/FPSAimTrainer/Saved/SaveGames/Themes/${file}` })
const sound = (file: string): ProfileFileReference => ({ name: file, path: `${SOUNDS}${file}` })
const none = [sound('none.ogg')]
const audio = (kill: string[], spawn: string[], changeNow = 'spawn05.ogg'): ProfileAudio =>
  ({ kill: kill.map(sound), spawn: spawn.map(sound), mbsGood: none, mbsOkay: none, mbsBad: none, mbsChangeNow: [sound(changeNow)] })
const profile = (id: string, themeFile: string, sounds: ProfileAudio): TrainingProfile => ({ schemaVersion: 2, id, name: id, theme: theme(themeFile), audio: sounds })

describe('profileInUse', () => {
  it('is true only when the theme and all six events match what the game holds', () => {
    expect(profileInUse(profile('t', 'clover bubbles.json', audio(['Bubble pop 4.ogg'], [])), game)).toBe(true)
  })
  it('compares the theme by the installed file its path names, not by the file name', () => {
    // The game records the theme's own name ("clover"), which differs from the file name.
    expect(profileInUse(profile('t', 'Clean Dark.json', audio(['Bubble pop 4.ogg'], [])), game)).toBe(false)
    expect(profileInUse(profile('t', 'missing.json', audio(['Bubble pop 4.ogg'], [])), game)).toBe(false)
  })
  it('compares every event, in order, an empty one included', () => {
    expect(profileInUse(profile('t', 'clover bubbles.json', audio(['Bubble pop 4.ogg'], ['Bell5.ogg'])), game)).toBe(false)
    expect(profileInUse(profile('t', 'clover bubbles.json', audio([], [])), game)).toBe(false)
    expect(profileInUse(profile('t', 'clover bubbles.json', audio(['Bubble pop 4.ogg'], [], 'Bell5.ogg')), game)).toBe(false)
    expect(profileInUse(profile('t', 'clover bubbles.json', audio(['Bubble pop 4.ogg', 'Bell5.ogg'], [])), { ...game, sounds: { ...bindings, kill: ['Bell5', 'Bubble pop 4'] } })).toBe(false)
  })
  it('is never true when the game could not be read', () => {
    const p = profile('t', 'clover bubbles.json', audio(['Bubble pop 4.ogg'], []))
    expect(profileInUse(p, null)).toBe(false)
    expect(profileInUse(p, { ...game, installedThemes: null })).toBe(false)
    expect(profileInUse(p, { ...game, sounds: null })).toBe(false)
  })
})

describe('snapshotFromGame: a new Profile starts as the game is', () => {
  it('takes the current theme file and every event, keeping an empty event as no sound', () => {
    const start = snapshotFromGame(game)
    expect(start.theme).toEqual({ name: 'clover bubbles.json', path: `${THEMES}clover bubbles.json` })
    expect(start.audio).toEqual({
      kill: [{ name: 'Bubble pop 4.ogg', path: `${SOUNDS}Bubble pop 4.ogg` }], spawn: [],
      mbsGood: [{ name: 'none.ogg', path: `${SOUNDS}none.ogg` }], mbsOkay: [{ name: 'none.ogg', path: `${SOUNDS}none.ogg` }],
      mbsBad: [{ name: 'none.ogg', path: `${SOUNDS}none.ogg` }], mbsChangeNow: [{ name: 'spawn05.ogg', path: `${SOUNDS}spawn05.ogg` }],
    })
  })
  it('leaves a part unchosen when the game names nothing installed, or two files share the name', () => {
    const start = snapshotFromGame({ ...game, theme: 'gone', sounds: { ...bindings, kill: ['gone'] },
      installedSounds: [...sounds, { name: 'spawn05', file: 'spawn05.wav', path: `${SOUNDS}spawn05.wav`, ambiguous: true }] })
    expect(start.theme).toBeNull()
    expect(start.audio.kill).toBeUndefined()
    expect(start.audio.mbsChangeNow).toBeUndefined()
    expect(start.audio.spawn).toEqual([])
  })
  it('leaves an MBS event unchosen when the game holds no sound for it, and still makes a draft', () => {
    const empty: AudioBindings = { kill: [], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] }
    const start = snapshotFromGame({ ...game, theme: null, sounds: empty })
    expect(start.audio).toEqual({ kill: [], spawn: [] })
    expect(() => createProfileDraft('a', 'A', start)).not.toThrow()
  })
  it('starts empty when the game could not be read', () => {
    expect(snapshotFromGame(null)).toEqual({ theme: null, audio: {} })
  })
})

function setup(profiles: TrainingProfile[]) {
  const saved: TrainingProfile[] = []
  const bridge: ProfileBridge = {
    list: async () => ({ directory: '/profiles', profiles, errors: [] }),
    read: async (id: string) => ({ filePath: `/profiles/${id}.json`, profile: structuredClone(profiles.find(p => p.id === id) ?? null) }),
    save: async p => { saved.push(p); return { filePath: `/profiles/${p.id}.json`, profile: p } },
    delete: async () => ({ deleted: true }),
  }
  const assets: ProfileAssetBridge = { chooseDirectory: async () => null, list: async () => ({ directory: '', files: [], errors: [] }), read: async () => new Uint8Array() }
  const refuse = async (): Promise<never> => { throw new Error('refused') }
  const locate: ProfileGameBridge = {
    discover: async () => ({ candidates: ['D:\\Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    schemeList: async () => ({ directory: '', current: 'clover', themes }),
    audioList: async () => ({ directory: '', sounds, bindings }),
    pickFolder: async () => null,
    planProfileApply: refuse, execute: refuse, job: refuse, reconcile: refuse, planFileAdd: refuse, pickFile: async () => null, launchGame: refuse,
  }
  render(<ProfilesApp bridge={bridge} assets={assets} locate={locate} />)
  return saved
}

describe('the Profile library', () => {
  it('tags the matching row 当前使用 with a grey 已在使用, and every other row can be applied', async () => {
    setup([profile('tracking', 'clover bubbles.json', audio(['Bubble pop 4.ogg'], [])), profile('flick', 'Clean Dark.json', audio([], ['Bell5.ogg']))])
    const inUse = await screen.findByRole('button', { name: '「tracking」已在使用' })
    expect(inUse).toBeDisabled()
    expect(within(inUse.closest('article') as HTMLElement).getByText('当前使用')).toBeVisible()
    const flick = screen.getByRole('button', { name: '应用 flick' })
    expect(flick).toBeEnabled()
    expect(within(flick.closest('article') as HTMLElement).queryByText('当前使用')).toBeNull()
  })

  it('describes a Profile by what it records, never 保持当前', async () => {
    setup([profile('flick', 'Clean Dark.json', audio([], ['Bell5.ogg']))])
    const row = await screen.findByRole('button', { name: '编辑 flick' })
    expect(row.textContent).toContain('Theme · Clean Dark.json')
    expect(row.textContent).toContain('Sounds · 生成 Bell5.ogg；MBS · Change now spawn05.ogg；其余 4 项无音效')
    expect(document.body.textContent).not.toContain('保持当前')
  })

  it('a new Profile starts as the game is and saves as a complete snapshot', async () => {
    const saved = setup([profile('tracking', 'clover bubbles.json', audio(['Bubble pop 4.ogg'], []))])
    // The existing row turns 已在使用 only once the game's settings have been read, which is
    // exactly what a new Profile starts from: a deterministic wait, not a timer.
    await screen.findByRole('button', { name: '「tracking」已在使用' })
    fireEvent.click(screen.getByRole('button', { name: '新建组合' }))
    expect(await screen.findByText('clover bubbles.json', { selector: '.pr-slot-foot strong' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '保存组合' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]!.theme?.name).toBe('clover bubbles.json')
    expect(saved[0]!.audio.spawn).toEqual([])
    expect(saved[0]!.audio.kill?.map(file => file.name)).toEqual(['Bubble pop 4.ogg'])
    // Saved from the game as it is, the new Profile is in use too.
    expect(await screen.findAllByRole('button', { name: /已在使用/ })).toHaveLength(2)
  })
})
