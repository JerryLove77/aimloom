import { StrictMode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioPage } from '../../../src/audio/AudioPage'
import type { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { AudioBindings, InstalledSound } from '../../../src/installer/contracts'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:audio'), revokeObjectURL: vi.fn() }))

const sounds: InstalledSound[] = [
  { name: 'Bell5', file: 'Bell5.ogg', path: 'D:/Game/FPSAimTrainer/sounds/Bell5.ogg', ambiguous: false },
  { name: 'hit', file: 'hit.wav', path: 'D:/Game/FPSAimTrainer/sounds/hit.wav', ambiguous: false },
  { name: 'Twice', file: 'Twice.ogg', path: 'D:/Game/FPSAimTrainer/sounds/Twice.ogg', ambiguous: true },
]
const bindings: AudioBindings = { kill: ['Bell5'], spawn: [], mbsGood: ['None'], mbsOkay: [], mbsBad: [], mbsChangeNow: ['spawn05'] }

function fixtures(start: AudioBindings = bindings) {
  const plans: { event: string; names: string[] }[] = []
  const bridge = {
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    audioList: async (root: string) => ({ directory: `${root}/sounds`, sounds, bindings: start }),
    planAudio: async (input: { event: string; names: string[] }) => { plans.push({ event: input.event, names: input.names }); return { planId: 'plan-1' } },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => ({ state: 'finished', result: { status: 'completed' } }),
    planFileAdd: async () => ({ planId: 'plan-add' }),
    pickFile: async () => null,
    reconcile: async () => ({}),
  }
  const assets: ProfileAssetBridge = {
    chooseDirectory: async () => null,
    list: async () => ({ directory: 'D:/Game/sounds', files: [], errors: [] }),
    read: async () => new Uint8Array([1, 2, 3]),
  }
  return { bridge, assets, plans }
}

const tree = (f: ReturnType<typeof fixtures>) => <AudioPage bridge={f.bridge} assets={f.assets} section={'audio' as WorkspaceSection} onSelect={() => {}} />

describe('Audio page', () => {
  beforeEach(() => { vi.mocked(URL.createObjectURL).mockClear() })

  it('shows the six events as one row of tabs and selects 击杀音效 by default', async () => {
    render(tree(fixtures()))
    const tabs = await screen.findByRole('group', { name: '音效事件' })
    const buttons = within(tabs).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['击杀音效', '生成音效', 'MBS · Good', 'MBS · Okay', 'MBS · Bad', 'MBS · Change now'])
    const kill = within(tabs).getByRole('button', { name: /^击杀音效/ })
    expect(kill).toHaveAttribute('aria-pressed', 'true')
    // The value moved out of the tab into the status strip; screen readers still hear it.
    expect(kill).toHaveAccessibleName('击杀音效（当前：Bell5）')
    expect(within(tabs).getByRole('button', { name: /^生成音效/ })).toHaveAccessibleName('生成音效（当前：未绑定）')
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('击杀音效：Bell5')
    expect(screen.getByRole('button', { name: '应用音效' })).toBeDisabled()
  })

  it('says in the editor whether the selected event takes a list or one sound', async () => {
    render(tree(fixtures()))
    const editor = await screen.findByRole('region', { name: '击杀音效 编辑' })
    expect(editor).toHaveTextContent('可绑定多个')
    fireEvent.click(screen.getByRole('button', { name: /^MBS · Good/ }))
    expect(screen.getByRole('region', { name: 'MBS · Good 编辑' })).toHaveTextContent('只绑定一个音效')
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('MBS · Good：None')
  })

  it('marks a tab whose event has a pending edit, in words as well as a dot', async () => {
    render(tree(fixtures()))
    fireEvent.click(await screen.findByRole('button', { name: '用 hit' }))
    fireEvent.click(screen.getByRole('button', { name: /^生成音效/ }))
    const kill = screen.getByRole('button', { name: /^击杀音效/ })
    expect(kill).toHaveAccessibleName('击杀音效（当前：Bell5），待应用')
    expect(kill.querySelector('.au-tab-dot')).not.toBeNull()
    expect(screen.getByRole('button', { name: /^生成音效/ }).querySelector('.au-tab-dot')).toBeNull()
  })

  it('picking a sound row marks the event 待应用; 取消更改 restores the binding', async () => {
    const f = fixtures()
    render(tree(f))
    const row = await screen.findByRole('button', { name: '用 hit' })
    expect(row).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '用 Bell5' })).toHaveTextContent('当前使用')
    fireEvent.click(row)
    // One click means "use this one": the list is replaced, not appended to.
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用击杀音效：hit')
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(row).toHaveTextContent('已选，未应用')
    const apply = screen.getByRole('button', { name: '应用音效' })
    expect(apply).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消更改' }))
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('待应用无')
    expect(apply).toBeDisabled()
    expect(f.plans).toEqual([])
  })

  it('picking the sound already in use is not a change', async () => {
    render(tree(fixtures()))
    fireEvent.click(await screen.findByRole('button', { name: '用 hit' }))
    fireEvent.click(screen.getByRole('button', { name: '用 Bell5' }))
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('待应用无')
    expect(screen.getByRole('button', { name: '应用音效' })).toBeDisabled()
  })

  it('keeps a pending edit on another event when the selection moves', async () => {
    render(tree(fixtures()))
    fireEvent.click(await screen.findByRole('button', { name: '用 hit' }))
    fireEvent.click(screen.getByRole('button', { name: /^生成音效/ }))
    expect(screen.getByRole('button', { name: /^击杀音效.*待应用/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /^击杀音效/ }))
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('已选，未应用击杀音效：hit')
  })

  it('applies only the selected event and says the others still need applying', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: '用 hit' }))
    fireEvent.click(screen.getByRole('button', { name: /^生成音效/ }))
    fireEvent.click(screen.getByRole('button', { name: '用 hit' }))
    fireEvent.click(screen.getByRole('button', { name: '应用音效' }))
    expect(await screen.findByRole('status', { name: '操作结果' })).toHaveTextContent('已更新生成音效')
    expect(f.plans).toEqual([{ event: 'spawn', names: ['hit'] }])
  })

  it('an MBS event holds one sound: no list editor and no 不使用音效', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: /^MBS · Good/ }))
    expect(screen.queryByRole('button', { name: '高级：绑定多个音效' })).toBeNull()
    expect(screen.queryByRole('button', { name: '不使用音效' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '用 Bell5' }))
    fireEvent.click(screen.getByRole('button', { name: '应用音效' }))
    await waitFor(() => expect(f.plans).toEqual([{ event: 'mbsGood', names: ['Bell5'] }]))
  })

  it('不使用音效 clears a list event', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: '不使用音效' }))
    expect(screen.getByRole('button', { name: '不使用音效' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '应用音效' }))
    await waitFor(() => expect(f.plans).toEqual([{ event: 'kill', names: [] }]))
  })

  it('keeps the list editor under 高级, where rows append instead of replacing', async () => {
    const f = fixtures()
    render(tree(f))
    const advanced = await screen.findByRole('button', { name: '高级：绑定多个音效' })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '加入 hit' })).toBeNull()
    expect(screen.queryByText(/要应用的列表/)).toBeNull()
    fireEvent.click(advanced)
    expect(advanced).toHaveAttribute('aria-expanded', 'true')
    // While building a list a row click must not wipe it, so rows stop being pick buttons.
    expect(screen.queryByRole('button', { name: '用 hit' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '加入 hit' }))
    expect(screen.getByText(/要应用的列表 · 2 个/)).toBeVisible()
    // A list of several sounds stays visible: the editor cannot be folded away over it.
    expect(advanced).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 个音效' }))
    expect(advanced).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '加入 Bell5' }))
    fireEvent.click(screen.getByRole('button', { name: '应用音效' }))
    await waitFor(() => expect(f.plans).toEqual([{ event: 'kill', names: ['hit', 'Bell5'] }]))
  })

  it('opens the list editor by itself when the event already holds several sounds', async () => {
    render(tree(fixtures({ ...bindings, kill: ['Bell5', 'hit'] })))
    const advanced = await screen.findByRole('button', { name: '高级：绑定多个音效' })
    expect(advanced).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/要应用的列表 · 2 个/)).toBeVisible()
  })

  it('filters the sounds as the player types, and can be cleared', async () => {
    render(tree(fixtures()))
    const search = await screen.findByRole('searchbox', { name: '搜索音效' })
    fireEvent.change(search, { target: { value: 'BE' } })
    expect(screen.getByRole('button', { name: '用 Bell5' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '用 hit' })).toBeNull()
    expect(screen.getByText(/匹配 1 \/ 3 个/)).toBeVisible()
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(/没有匹配「zzz」的音效/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(search).toHaveValue('')
    expect(screen.getByRole('button', { name: '用 hit' })).toBeVisible()
  })

  it('audition is an explicit play control and refuses an ambiguous name', async () => {
    render(tree(fixtures()))
    const play = await screen.findByRole('button', { name: '试听 hit' })
    expect(play).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '用 Twice' })).toBeDisabled()
    expect(screen.getByText('有多个同名文件，无法绑定')).toBeVisible()
  })

  it('renders nothing while another section is active', () => {
    const f = fixtures()
    render(<AudioPage bridge={f.bridge} assets={f.assets} isActive={false} section={'profile' as WorkspaceSection} onSelect={() => {}} />)
    expect(screen.queryByText('音效')).toBeNull()
  })

  it('still auditions after React replays the mount effects', async () => {
    // StrictMode runs effects mount → cleanup → mount on the same memoized preview. A cleanup
    // that disposed it left every later 试听 silently doing nothing, with no error shown.
    const f = fixtures()
    const read = vi.spyOn(f.assets, 'read')
    render(<StrictMode><AudioPage bridge={f.bridge} assets={f.assets} section={'audio' as WorkspaceSection} onSelect={() => {}} /></StrictMode>)
    fireEvent.click(await screen.findByRole('button', { name: '试听 Bell5' }))
    await waitFor(() => expect(read).toHaveBeenCalledWith('audio', 'D:/Game/FPSAimTrainer/sounds/Bell5.ogg'))
  })
})
