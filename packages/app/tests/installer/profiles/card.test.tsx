import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ProfilesApp } from '../../../src/profiles/ProfilesApp'
import type { ProfileBridge } from '../../../src/profiles/bridge'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import { createTrainingProfile, type TrainingProfile } from '../../../src/profiles/model'

/**
 * PF-CARDS: each of the two component cards (Theme, Sounds) is a corner chip naming the card, a
 * preview filling the body, and the name on a bottom line. An orange outline
 * (`pr-slot-recorded`) marks a card the Profile records, and that distinction also reads in
 * words -- never by the outline colour alone.
 */
const themeBytes = new TextEncoder().encode(JSON.stringify({ themeName: 'Blue', wallMaterial: 'DRYWALL', floorMaterial: 'DRYWALL', wallTint: { x: 0.1, y: 0.3, z: 0.8 } }))

function setup(profile: TrainingProfile) {
  const bridge: ProfileBridge = {
    list: async () => ({ directory: '/profiles', profiles: [profile], errors: [] }),
    read: async () => ({ filePath: '/profiles/p.json', profile: structuredClone(profile) }),
    save: async p => ({ filePath: '/profiles/p.json', profile: p }),
    delete: async () => ({ deleted: true }),
  }
  const assets: ProfileAssetBridge = { chooseDirectory: async () => null, list: async () => ({ directory: '', files: [], errors: [] }), read: async () => themeBytes }
  render(<ProfilesApp bridge={bridge} assets={assets} />)
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:card-preview'), revokeObjectURL: vi.fn() }))
})

describe('the Profile editor cards', () => {
  it('shows a corner chip, a preview area and a name line for each card', async () => {
    setup(createTrainingProfile('p', '组合'))
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

  it('keeps the empty state to one muted, centred sentence, with no orange outline', async () => {
    setup(createTrainingProfile('p', '组合'))
    fireEvent.click(await screen.findByRole('button', { name: '编辑 组合' }))
    await screen.findByLabelText('Profile 名称')
    const cards = [...document.querySelectorAll('.pr-slot')] as HTMLElement[]
    for (const card of cards) {
      expect(card.classList.contains('pr-slot-recorded')).toBe(false)
      const body = card.querySelector('.pr-slot-body')!
      const sentence = body.querySelector('.pr-preview-empty')
      expect(sentence).toBeTruthy()
      // One sentence, not a paragraph of several.
      expect((sentence!.textContent ?? '').split(/(?<=[。.])/).filter(Boolean)).toHaveLength(1)
      // The distinction is in words too: the tag beside the chip and the bottom line both name it.
      expect(within(card).getAllByText('保持当前').length).toBeGreaterThan(0)
    }
  })

  it('marks a recorded Theme with the orange outline and its real file name, not by colour alone', async () => {
    setup({ ...createTrainingProfile('p', '组合'), scheme: { name: 'Blue.json', path: 'C:/themes/Blue.json' } })
    fireEvent.click(await screen.findByRole('button', { name: '编辑 组合' }))
    await screen.findByLabelText('Profile 名称')
    const themeCard = document.querySelectorAll('.pr-slot')[0] as HTMLElement
    expect(themeCard.classList.contains('pr-slot-recorded')).toBe(true)
    expect(within(themeCard).queryByText('保持当前')).toBeNull()
    expect(themeCard.querySelector('.pr-slot-foot strong')?.textContent).toBe('Blue.json')
    await within(themeCard).findByRole('img')
  })

  it('marks recorded Sounds with the orange outline and a per-event list filling the body', async () => {
    setup({ ...createTrainingProfile('p', '组合'), audio: { kill: [{ name: 'pop.wav', path: 'C:/s/pop.wav' }], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] } })
    fireEvent.click(await screen.findByRole('button', { name: '编辑 组合' }))
    await screen.findByLabelText('Profile 名称')
    const soundsCard = document.querySelectorAll('.pr-slot')[1] as HTMLElement
    expect(soundsCard.classList.contains('pr-slot-recorded')).toBe(true)
    const list = soundsCard.querySelector('.pr-slot-audio-list')
    expect(list).toBeTruthy()
    expect(list!.querySelectorAll('li')).toHaveLength(6)
    expect(list!.textContent).toContain('pop.wav')
    // Kept events still say so in the same list, in words.
    expect(list!.textContent).toContain('保持当前')
  })
})
