import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ProfilesApp, type ProfileGameBridge } from '../../../src/profiles/ProfilesApp'
import { profileInUse, type CurrentGame } from '../../../src/profiles/current-game'
import type { ProfileBridge } from '../../../src/bridge/profiles'
import type { ProfileAssetBridge } from '../../../src/bridge/assets'
import type { AudioBindings } from '../../../src/bridge/contracts'
import type { TrainingProfile } from '../../../src/profiles/model'

/**
 * The user on test.200 (2026-09-30): after applying "tracking", its 应用 stayed bright and the
 * keep-everything "favoriate" stayed grey, which read as "favoriate is in use". A row now says
 * 当前使用 when the game holds exactly what it records, and a Profile with nothing to apply says so.
 */
const themes = [
  { name: 'clover', file: 'clover bubbles.json', path: 'D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\Themes\\clover bubbles.json', readable: true, duplicateName: false },
  { name: 'Clean Dark', file: 'Clean Dark.json', path: 'D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\Themes\\Clean Dark.json', readable: true, duplicateName: false },
]
const sounds = [
  { name: 'Bubble pop 4', file: 'Bubble pop 4.ogg', path: 'D:\\Game\\FPSAimTrainer\\sounds\\Bubble pop 4.ogg', ambiguous: false },
  { name: 'Bell5', file: 'Bell5.ogg', path: 'D:\\Game\\FPSAimTrainer\\sounds\\Bell5.ogg', ambiguous: false },
]
const bindings: AudioBindings = { kill: ['Bubble pop 4'], spawn: ['Bell5'], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] }
const game: CurrentGame = { theme: 'clover', sounds: bindings, installedThemes: themes, installedSounds: sounds }
const profile = (id: string, scheme: TrainingProfile['scheme'], audio: TrainingProfile['audio']): TrainingProfile => ({ schemaVersion: 1, id, name: id, scheme, audio })
// A recorded path as the Profile sheet writes it; the engine compares full paths ignoring case.
const theme = (file: string) => ({ name: file, path: `d:/game/FPSAimTrainer/Saved/SaveGames/Themes/${file}` })
const sound = (file: string) => ({ name: file, path: `D:\\Game\\FPSAimTrainer\\sounds\\${file}` })

describe('profileInUse', () => {
  it('is true when every recorded part matches what the game holds, and kept parts are not compared', () => {
    expect(profileInUse(profile('t', theme('clover bubbles.json'), { kill: [sound('Bubble pop 4.ogg')], spawn: [] }), game)).toBe(true)
    expect(profileInUse(profile('t', theme('clover bubbles.json'), null), game)).toBe(true)
    expect(profileInUse(profile('t', null, { spawn: [sound('Bell5.ogg')] }), game)).toBe(true)
  })
  it('compares the theme by the installed file its path names, not by the file name', () => {
    // The game records the theme's own name ("clover"), which differs from the file name.
    expect(profileInUse(profile('t', theme('Clean Dark.json'), null), game)).toBe(false)
    expect(profileInUse(profile('t', theme('missing.json'), null), game)).toBe(false)
  })
  it('compares each recorded event in order and by length', () => {
    expect(profileInUse(profile('t', null, { kill: [sound('Bell5.ogg')] }), game)).toBe(false)
    expect(profileInUse(profile('t', null, { kill: [sound('Bubble pop 4.ogg'), sound('Bell5.ogg')] }), game)).toBe(false)
    expect(profileInUse(profile('t', null, { kill: [sound('Bubble pop 4.ogg')] }), { ...game, sounds: { ...bindings, kill: ['Bell5', 'Bubble pop 4'] } })).toBe(false)
  })
  it('is never true for a Profile that keeps everything, or when the game could not be read', () => {
    expect(profileInUse(profile('t', null, null), game)).toBe(false)
    expect(profileInUse(profile('t', null, { kill: [], spawn: [] }), game)).toBe(false)
    expect(profileInUse(profile('t', theme('clover bubbles.json'), null), null)).toBe(false)
    expect(profileInUse(profile('t', theme('clover bubbles.json'), null), { ...game, installedThemes: null })).toBe(false)
  })
})

describe('the Profile library says which Profile is in use', () => {
  it('tags the matching row 当前使用 with 已在使用, and says when there is nothing to apply', async () => {
    const profiles = [
      profile('tracking', theme('clover bubbles.json'), { kill: [sound('Bubble pop 4.ogg')], spawn: [] }),
      profile('favoriate', null, null),
      profile('flick', theme('Clean Dark.json'), null),
    ]
    const bridge: ProfileBridge = {
      list: async () => ({ directory: '/profiles', profiles, errors: [] }),
      read: async (id: string) => ({ filePath: `/profiles/${id}.json`, profile: structuredClone(profiles.find(p => p.id === id) ?? null) }),
      save: async p => ({ filePath: `/profiles/${p.id}.json`, profile: p }),
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
    const inUse = await screen.findByRole('button', { name: '「tracking」已在使用' })
    expect(inUse).toBeDisabled()
    const trackingRow = inUse.closest('article') as HTMLElement
    expect(within(trackingRow).getByText('当前使用')).toBeVisible()
    const favRow = screen.getByRole('button', { name: '应用 favoriate' }).closest('article') as HTMLElement
    expect(screen.getByRole('button', { name: '应用 favoriate' })).toBeDisabled()
    expect(within(favRow).getByText('没有要应用的内容')).toBeVisible()
    expect(within(favRow).queryByText('当前使用')).toBeNull()
    expect(screen.getByRole('button', { name: '应用 flick' })).toBeEnabled()
  })
})
