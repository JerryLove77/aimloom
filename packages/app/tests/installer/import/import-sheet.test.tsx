import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImportSheet } from '../../../src/workspace/ImportSheet'
import { sha256Hex } from '../../../../crosshair/src/png'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { InstalledEntry } from '../../../src/workspace/import-check'
import type { FileImportInput } from '../../../src/workspace/file-import'
import { LangProvider, type Msg } from '../../../src/i18n'
import { InstallerFailure } from '../../../src/installer/contracts'

const themeBytes = (themeName: string) => new TextEncoder().encode(JSON.stringify({ themeName, wallTint: { x: 0, y: 0, z: 0 } }))
const SOURCE = 'C:\\Users\\me\\Downloads\\Night.json'

function setup(options: {
  kind?: 'theme' | 'sound'; sourcePath?: string; bytes?: Uint8Array; readError?: Error
  installed?: InstalledEntry[]; busy?: boolean; error?: Msg | null; added?: boolean; lang?: 'zh' | 'en'
} = {}) {
  const reads: string[] = []
  const bytes = options.bytes ?? themeBytes('Night')
  const assets: ProfileAssetBridge = {
    chooseDirectory: async () => null,
    list: async () => ({ directory: '', files: [], errors: [] }),
    read: async (kind, path) => { reads.push(`${kind}:${path}`); if (options.readError) throw options.readError; return bytes },
  }
  const onAdd = vi.fn(async (_input: FileImportInput) => options.added ?? true)
  const onClose = vi.fn()
  const kind = options.kind ?? 'theme'
  const sheet = <ImportSheet kind={kind} sourcePath={options.sourcePath ?? SOURCE} directory="D:\Game\FPSAimTrainer\Saved\SaveGames\Themes"
    installed={options.installed ?? []} assets={assets} busy={options.busy ?? false} error={options.error ?? null}
    preview={<p>预览占位</p>} onAdd={onAdd} onClose={onClose} />
  render(options.lang === 'en' ? <LangProvider storage={null} languages={['en-US']}>{sheet}</LangProvider> : sheet)
  return { reads, bytes, onAdd, onClose }
}
const addButton = () => screen.getByRole('button', { name: '添加到游戏' })

describe('add-to-game sheet', () => {
  it('shows where the file comes from and where it goes, then hands over its path, hash and name', async () => {
    const f = setup()
    const sheet = screen.getByRole('dialog', { name: '添加主题到游戏' })
    expect(within(sheet).getByText(SOURCE)).toBeVisible()
    expect(within(sheet).getByText('D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\Themes')).toBeVisible()
    expect(within(sheet).getByText(/原样复制，不修改内容/)).toBeVisible()
    expect((await within(sheet).findByText('主题内部名称')).parentElement).toHaveTextContent('主题内部名称Night')
    expect(screen.getByLabelText('文件名')).toHaveValue('Night')
    await waitFor(() => expect(addButton()).toBeEnabled())
    fireEvent.click(addButton())
    await waitFor(() => expect(f.onAdd).toHaveBeenCalledOnce())
    expect(f.onAdd).toHaveBeenCalledWith({ sourcePath: SOURCE, sourceSha256: await sha256Hex(f.bytes), file: 'Night.json' })
    expect(f.reads).toEqual([`scheme:${SOURCE}`])
  })

  it('lets the player rename the file but keeps the extension fixed', async () => {
    const f = setup()
    await waitFor(() => expect(addButton()).toBeEnabled())
    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: 'Dusk' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(f.onAdd).toHaveBeenCalledOnce())
    expect(f.onAdd.mock.calls[0]![0]).toMatchObject({ file: 'Dusk.json' })
  })

  it('refuses a theme whose internal name is already installed, before anything is sent', async () => {
    const f = setup({ installed: [{ name: 'night', file: 'Old night.json' }] })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Night')
    expect(alert).toHaveTextContent('Old night.json')
    expect(addButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: 'Another name' } })
    expect(addButton()).toBeDisabled()
    expect(f.onAdd).not.toHaveBeenCalled()
  })

  it('refuses a taken file name until the player picks another one', async () => {
    setup({ installed: [{ name: 'Other', file: 'night.JSON' }] })
    await waitFor(() => expect(screen.getByLabelText('文件名')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText(/已经有「night\.JSON」/)).toBeVisible()
    expect(addButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: 'Night 2' } })
    await waitFor(() => expect(addButton()).toBeEnabled())
  })

  it('refuses a file that is not a theme', async () => {
    setup({ bytes: new TextEncoder().encode('[1, 2]') })
    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON 对象/)
    expect(addButton()).toBeDisabled()
  })

  it('blocks the add when the file cannot be read, and says what usually causes it', async () => {
    setup({ readError: new Error('不能读取链接目录中的文件。') })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('不能读取链接目录中的文件。')
    expect(alert).toHaveTextContent(/OneDrive/)
    expect(addButton()).toBeDisabled()
  })

  it('shows the English half of a read failure to an English player, not its Chinese', async () => {
    // The bridge rejects with an InstallerFailure whose `message` is Chinese and whose
    // `messageEn` is the English twin; the English UI must read the English one.
    setup({ lang: 'en', readError: new InstallerFailure({ code: 'ENGINE_ERROR', message: '不能读取链接目录中的文件。', messageEn: 'The file in the linked folder could not be read.', path: null }) })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The file in the linked folder could not be read.')
    expect(alert.textContent ?? '').not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/)
  })

  it('shows an engine refusal and stays open', async () => {
    const f = setup({ error: { zh: '游戏里的「Blue.json」已经叫这个名字。', en: 'The game already has something named "Blue.json".' }, added: false })
    expect(await screen.findByText('游戏里的「Blue.json」已经叫这个名字。')).toBeVisible()
    await waitFor(() => expect(addButton()).toBeEnabled())
    fireEvent.click(addButton())
    await waitFor(() => expect(f.onAdd).toHaveBeenCalledOnce())
    expect(f.onClose).not.toHaveBeenCalled()
  })

  it('cannot be dismissed while the add is running', async () => {
    const f = setup({ busy: true })
    expect(screen.getByRole('button', { name: '正在添加…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(f.onClose).not.toHaveBeenCalled()
  })

  it('closes with Escape or 取消 when idle, and writes nothing', async () => {
    const f = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(f.onClose).toHaveBeenCalledTimes(2)
    expect(f.onAdd).not.toHaveBeenCalled()
  })

  it('adds a sound under the sound rules', async () => {
    const f = setup({ kind: 'sound', sourcePath: 'C:\\Users\\me\\Downloads\\Soft hit.WAV', bytes: new Uint8Array([82, 73, 70, 70]), installed: [{ name: 'hit', file: 'hit.ogg' }] })
    expect(screen.getByRole('dialog', { name: '添加音效到游戏' })).toBeVisible()
    expect(f.reads).toEqual(['audio:C:\\Users\\me\\Downloads\\Soft hit.WAV'])
    await waitFor(() => expect(addButton()).toBeEnabled())
    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: 'a;b' } })
    expect(screen.getByText(/分号/)).toBeVisible()
    expect(addButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: 'hit' } })
    expect(screen.getByText(/同名音效「hit\.ogg」/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('文件名'), { target: { value: 'Soft hit' } })
    fireEvent.click(addButton())
    await waitFor(() => expect(f.onAdd).toHaveBeenCalledOnce())
    expect(f.onAdd.mock.calls[0]![0]).toMatchObject({ file: 'Soft hit.WAV' })
  })
})
