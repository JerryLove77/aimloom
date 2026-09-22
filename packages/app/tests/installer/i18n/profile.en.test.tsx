import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { ProfilesApp } from '../../../src/profiles/ProfilesApp'
import { createDemoProfileBridge, createDemoAssetBridge } from '../../../src/profiles/demo'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:profile-en'), revokeObjectURL: vi.fn() }))

const CJK = /[　-〿㐀-鿿＀-￯]/
// The browser demo's own Profile names are Chinese content (see profiles/demo.ts); they are
// expected to remain Chinese even in the English UI, so they are stripped before the CJK check.
const DEMO_NAMES = ['日常跟枪', '专注练习']
const stripDemoNames = (text: string) => DEMO_NAMES.reduce((acc, name) => acc.split(name).join(''), text)

function renderProfiles() {
  return render(
    <LangProvider storage={null} languages={['en-US']}>
      <ProfilesApp bridge={createDemoProfileBridge()} assets={createDemoAssetBridge()} isDemo />
    </LangProvider>,
  )
}

describe('the Profile section in English', () => {
  it('shows the library heading, eyebrow and main actions in English, with no Chinese besides demo names', async () => {
    renderProfiles()
    const heading = await screen.findByRole('heading', { name: 'My combinations', level: 1 })
    const main = heading.closest('main') ?? heading.parentElement!.parentElement!
    expect(within(main).getByText('PROFILE · Library')).toBeVisible()
    await screen.findByRole('button', { name: 'New combination' })
    await screen.findByRole('button', { name: 'Refresh' })
    // Row summaries use the glossary names of the two sections, not the Chinese UI's labels.
    const row = await screen.findByRole('button', { name: /Edit 日常跟枪/ })
    expect(row.textContent).toContain('Theme · Blue-room.json')
    expect(row.textContent).toContain('Sounds · ')
    expect(row.textContent).not.toMatch(/Scheme|Audio|Enemy/)
    expect(stripDemoNames(main.textContent ?? '')).not.toMatch(CJK)
  })

  it('shows the two setup cards in English for a Profile with a Chinese name', async () => {
    renderProfiles()
    const editButton = await screen.findByRole('button', { name: /Edit 日常跟枪/ })
    fireEvent.click(editButton)
    await screen.findByRole('heading', { name: 'Edit Profile', level: 1 })
    // Sounds shows the label alone; only Theme adds a subtitle that says something the name no
    // longer does. A Profile no longer has an Enemy card.
    const kinds = [...document.querySelectorAll('.pr-slot-kind')].map(node => node.textContent)
    expect(kinds).toEqual(['THEME · Background and environment', 'SOUNDS'])
    await screen.findByRole('button', { name: /^Theme Background and environment: Blue-room\.json$/ })
  })

  it('opens the audio sheet in English for the same Profile', async () => {
    renderProfiles()
    const editButton = await screen.findByRole('button', { name: /Edit 日常跟枪/ })
    fireEvent.click(editButton)
    const audioSlot = await screen.findByRole('button', { name: /^Sounds: / })
    fireEvent.click(audioSlot)
    const dialog = await screen.findByRole('dialog', { name: /Choose the sounds for 日常跟枪/ })
    expect(within(dialog).getByText('Sound event')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Use for this combination' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(stripDemoNames(dialog.textContent ?? '')).not.toMatch(CJK)
  })
})

describe('the Profile browser demo', () => {
  it('throws its own failures in both languages', async () => {
    const storage = { getItem: () => '{', setItem: () => {} }
    await expect(createDemoProfileBridge(storage).list()).rejects.toMatchObject({
      issue: { message: '浏览器演示数据无法读取，请检查浏览器存储。', messageEn: "Can't read the browser demo data. Check the browser's storage." },
    })
    await expect(createDemoProfileBridge({ getItem: () => '{}', setItem: () => {} }).list()).rejects.toMatchObject({
      issue: { message: '浏览器演示数据格式无效。', messageEn: 'The browser demo data is in an invalid format.' },
    })
    const assets = createDemoAssetBridge()
    await expect(assets.list('scheme', '/elsewhere')).rejects.toMatchObject({
      issue: { message: '演示模式仅提供演示素材，请点击“浏览演示素材”。', messageEn: 'Demo mode offers only demo assets. Click "Browse demo assets".' },
    })
    await expect(assets.read('scheme', '/demo/scheme/Missing.json')).rejects.toMatchObject({
      issue: { message: '演示素材不存在。', messageEn: "This demo asset doesn't exist." },
    })
  })
})
