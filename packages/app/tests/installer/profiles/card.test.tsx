import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProfilesApp } from '../../../src/profiles/ProfilesApp'
import type { ProfileBridge } from '../../../src/bridge/profiles'
import type { ProfileAssetBridge } from '../../../src/bridge/assets'
import type { ProfileAudio, TrainingProfile } from '../../../src/profiles/model'

/**
 * PF-CARDS: each of the two component cards (Theme, Sounds) is a corner chip naming the card, a
 * preview filling the body, and the name on a bottom line. An orange outline
 * (`pr-slot-recorded`) marks a complete card. A saved Profile is always complete (v2, 2026-09-30);
 * only a new draft whose part the game could not name has an unchosen card, and that reads in
 * words (「未选择」) too -- never by the outline colour alone.
 */
const none = [{ name: 'none.ogg', path: 'C:/s/none.ogg' }]
const audio: ProfileAudio = { kill: [{ name: 'pop.wav', path: 'C:/s/pop.wav' }], spawn: [], mbsGood: none, mbsOkay: none, mbsBad: none, mbsChangeNow: none }
const saved = (): TrainingProfile => ({ schemaVersion: 2, id: 'p', name: '组合', theme: { name: 'Blue.json', path: 'C:/themes/Blue.json' }, audio })
const themeBytes = new TextEncoder().encode(JSON.stringify({ themeName: 'Blue', wallMaterial: 'DRYWALL', floorMaterial: 'DRYWALL', wallTint: { x: 0.1, y: 0.3, z: 0.8 } }))

function setup(profile: TrainingProfile | null) {
  const bridge: ProfileBridge = {
    list: async () => ({ directory: '/profiles', profiles: profile ? [profile] : [], errors: [] }),
    read: async () => ({ filePath: '/profiles/p.json', profile: structuredClone(profile) }),
    save: async p => ({ filePath: '/profiles/p.json', profile: p }),
    delete: async () => ({ deleted: true }),
    favoritesRead: async () => ({ theme: [], audio: [] }), favoritesSave: async favorites => favorites,
  }
  const assets: ProfileAssetBridge = { chooseDirectory: async () => null, list: async () => ({ directory: '', files: [], errors: [] }), read: async () => themeBytes }
  render(<ProfilesApp bridge={bridge} assets={assets} />)
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:card-preview'), revokeObjectURL: vi.fn() }))
})

describe('the Profile editor cards', () => {
  it('shows a corner chip, a preview area and a name line for each card', async () => {
    setup(saved())
    fireEvent.click(await screen.findByRole('button', { name: '编辑 组合' }))
    await screen.findByLabelText('Profile 名称')
    const cards = document.querySelectorAll('.pr-slot')
    expect(cards).toHaveLength(2)
    const [themeCard, soundsCard] = [...cards] as [HTMLElement, HTMLElement]
    expect(themeCard.querySelector('.pr-slot-kind')?.textContent).toBe('THEME')
    expect(themeCard.querySelector('.pr-slot-body')).toBeTruthy()
    expect(themeCard.querySelector('.pr-slot-foot strong')).toBeTruthy()
    expect(soundsCard.querySelector('.pr-slot-kind')?.textContent).toBe('SOUNDS')
    expect(soundsCard.querySelector('.pr-slot-body')).toBeTruthy()
    expect(soundsCard.querySelector('.pr-slot-foot strong')).toBeTruthy()
  })

  it('a new draft the game could not fill says 未选择 in words, with no orange outline', async () => {
    // No game bridge here, so the new Profile cannot start from the game's settings.
    setup(null)
    fireEvent.click(await screen.findByRole('button', { name: '新建组合' }))
    await screen.findByLabelText('Profile 名称')
    const [themeCard, soundsCard] = [...document.querySelectorAll('.pr-slot')] as [HTMLElement, HTMLElement]
    for (const card of [themeCard, soundsCard]) {
      expect(card.classList.contains('pr-slot-recorded')).toBe(false)
      expect(within(card).getAllByText(/未选择/).length).toBeGreaterThan(0)
    }
    const sentence = themeCard.querySelector('.pr-preview-empty')
    expect(sentence?.textContent).toBe('还没选背景与环境')
    // Nothing unchosen can be saved.
    fireEvent.click(screen.getByRole('button', { name: '保存组合' }))
    expect(await screen.findByText(/背景和 6 个音效事件都要选好才能保存/)).toBeVisible()
  })

  it('marks a complete Theme with the orange outline and its real file name, not by colour alone', async () => {
    setup(saved())
    fireEvent.click(await screen.findByRole('button', { name: '编辑 组合' }))
    await screen.findByLabelText('Profile 名称')
    const themeCard = document.querySelectorAll('.pr-slot')[0] as HTMLElement
    expect(themeCard.classList.contains('pr-slot-recorded')).toBe(true)
    expect(within(themeCard).queryByText('未选择')).toBeNull()
    expect(themeCard.querySelector('.pr-slot-foot strong')?.textContent).toBe('Blue.json')
    await within(themeCard).findByRole('img')
  })

  it('lists all six sound events in the Sounds card, silent ones as 无音效', async () => {
    setup(saved())
    fireEvent.click(await screen.findByRole('button', { name: '编辑 组合' }))
    await screen.findByLabelText('Profile 名称')
    const soundsCard = document.querySelectorAll('.pr-slot')[1] as HTMLElement
    expect(soundsCard.classList.contains('pr-slot-recorded')).toBe(true)
    const items = [...soundsCard.querySelectorAll('.pr-slot-audio-list li')].map(li => li.textContent)
    expect(items).toHaveLength(6)
    expect(items[0]).toBe('击杀 pop.wav')
    expect(items[1]).toBe('生成 无音效')
    expect(items.slice(2).every(text => text?.endsWith('无音效'))).toBe(true)
  })
})
