import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LangProvider } from '../../../src/i18n'
import { ResourceSheet } from '../../../src/profiles/ResourceSheet'
import { AudioSheet } from '../../../src/profiles/AudioSheet'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))

/** A listing whose one unreadable file carries no usable text, so the caller's fallback shows. */
function bridge(files: { name: string; path: string }[]): ProfileAssetBridge {
  return {
    chooseDirectory: async () => '/assets',
    list: async () => ({ directory: '/assets', files, errors: [{ fileName: '坏掉的文件.json', message: '', messageEn: '' }] }),
    read: async () => new TextEncoder().encode(JSON.stringify({ themeName: 'Blue', wallTint: { x: 0, y: 0, z: 0 } })),
  }
}
const render_ = (lang: 'zh' | 'en', node: React.ReactElement) =>
  render(<LangProvider storage={null} languages={[lang === 'zh' ? 'zh-CN' : 'en-US']}>{node}</LangProvider>)

describe('an unreadable asset file gets its own message, not the Profile one', () => {
  const sheet = () => <ResourceSheet kind="scheme" profileName="每日训练" profilePath="/profiles/p1.json"
    value={{ name: 'Blue.json', path: '/assets/Blue.json' }} assets={bridge([{ name: 'Blue.json', path: '/assets/Blue.json' }])}
    isDemo open onConfirm={() => {}} onCancel={() => {}} />

  it('Chinese names the file, not the Profile', async () => {
    render_('zh', sheet())
    expect(await screen.findByText('坏掉的文件.json：无法读取这个文件。')).toBeInTheDocument()
    expect(screen.queryByText(/无法读取该配置档/)).toBeNull()
  })
  it('English names the file, not the Profile', async () => {
    render_('en', sheet())
    expect(await screen.findByText("坏掉的文件.json: Can't read this file.")).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't read this Profile/)).toBeNull()
  })
})

describe('the audio sheet shows the files it could not read', () => {
  const sheet = () => <AudioSheet profileName="每日训练" profilePath="/profiles/p1.json" value={null}
    assets={bridge([])} isDemo open onConfirm={() => {}} onCancel={() => {}} />

  it('Chinese: the unreadable file is listed under a warning', async () => {
    render_('zh', sheet())
    fireEvent.click(screen.getByRole('button', { name: '浏览演示素材' }))
    expect(await screen.findByText('1 个文件未能使用')).toBeInTheDocument()
    expect(screen.getByText('坏掉的文件.json：无法读取这个文件。')).toBeInTheDocument()
  })
  it('English: the unreadable file is listed under a warning', async () => {
    render_('en', sheet())
    fireEvent.click(screen.getByRole('button', { name: 'Browse demo assets' }))
    expect(await screen.findByText("1 file couldn't be used")).toBeInTheDocument()
    expect(screen.getByText("坏掉的文件.json: Can't read this file.")).toBeInTheDocument()
  })
  it('the sheet still closes on Cancel while the warning is shown', async () => {
    const onCancel = vi.fn()
    render_('zh', <AudioSheet profileName="每日训练" profilePath="/profiles/p1.json" value={null}
      assets={bridge([])} isDemo open onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '浏览演示素材' }))
    await screen.findByText('1 个文件未能使用')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
