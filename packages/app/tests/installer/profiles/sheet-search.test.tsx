import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { ResourceSheet } from '../../../src/profiles/ResourceSheet'
import { AudioSheet } from '../../../src/profiles/AudioSheet'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))

function bridge(files: { name: string; path: string }[]): ProfileAssetBridge {
  return {
    chooseDirectory: async () => '/game/sounds',
    list: async () => ({ directory: '/game/sounds', files, errors: [] }),
    read: async () => new TextEncoder().encode(JSON.stringify({ themeName: 'Blue', wallTint: { x: 0, y: 0, z: 0 } })),
  }
}
const render_ = (lang: 'zh' | 'en', node: React.ReactElement) =>
  render(<LangProvider storage={null} languages={[lang === 'zh' ? 'zh-CN' : 'en-US']}>{node}</LangProvider>)

// Eight themes: more than one page of six, so the one searched for starts on page two.
const THEMES = ['Aqua', 'Blue', 'Coral', 'Dusk', 'Ember', 'Forest', 'Glacier', 'Harbor'].map(name => ({
  file: `${name}.json`, label: name, detail: '', path: `/game/themes/${name}.json`, selectable: true,
}))

describe('the Theme sheet in a Profile has a search box', () => {
  const sheet = (onConfirm = vi.fn()) => <ResourceSheet kind="scheme" profileName="每日训练" profilePath="/profiles/p1.json"
    value={null} assets={bridge([])} isDemo={false} open installed={THEMES} onConfirm={onConfirm} onCancel={() => {}} />

  it('finds a theme on a later page without paging', () => {
    render_('zh', sheet())
    expect(screen.queryByRole('button', { name: 'Harbor 预览' })).toBeNull()
    fireEvent.change(screen.getByLabelText('搜索主题'), { target: { value: '  harb ' } })
    expect(screen.getByRole('button', { name: 'Harbor 预览' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aqua 预览' })).toBeNull()
  })
  it('a theme found by search can be chosen for the Profile', () => {
    const onConfirm = vi.fn()
    render_('en', sheet(onConfirm))
    fireEvent.change(screen.getByLabelText('Search themes'), { target: { value: 'glac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Glacier preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use for this combination' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ path: '/game/themes/Glacier.json' }))
  })
  it('says so when nothing matches, and clearing brings the grid back', () => {
    render_('en', sheet())
    fireEvent.change(screen.getByLabelText('Search themes'), { target: { value: 'zzz' } })
    expect(screen.getByText('No theme matches "zzz".')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('button', { name: 'Aqua preview' })).toBeInTheDocument()
  })
})

describe('the Sounds sheet in a Profile has a search box', () => {
  const SOUNDS = ['Headshot.ogg', 'Kill Confirm.ogg', 'Spawn Bell.wav'].map(name => ({ name, path: `/game/sounds/${name}` }))
  const sheet = () => <AudioSheet profileName="每日训练" profilePath="/profiles/p1.json" value={null}
    assets={bridge(SOUNDS)} isDemo={false} open defaultDirectory="/game/sounds" onConfirm={() => {}} onCancel={() => {}} />

  it('narrows the game\'s sounds by name', async () => {
    render_('zh', sheet())
    expect(await screen.findByRole('button', { name: '添加 Headshot.ogg' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜索音效'), { target: { value: 'BELL' } })
    expect(screen.getByRole('button', { name: '添加 Spawn Bell.wav' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加 Headshot.ogg' })).toBeNull()
  })
  it('says so when nothing matches', async () => {
    render_('en', sheet())
    await screen.findByRole('button', { name: 'Add Headshot.ogg' })
    fireEvent.change(screen.getByLabelText('Search sounds'), { target: { value: 'zzz' } })
    expect(screen.getByText('No sound matches "zzz".')).toBeInTheDocument()
  })
})
