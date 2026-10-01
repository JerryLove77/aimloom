import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../../src/workspace/Workspace'
import { createDemoBridge } from '../../../src/bridge/demo'
import { createDemoProfileBridge, createDemoAssetBridge } from '../../../src/bridge/profiles-demo'
import { createManualFileDropSource } from '../../../src/workspace/file-drop'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
beforeEach(() => { localStorage.clear() })

/** A full demo Quick import of the sample folder, which adds the theme "Aimloom Demo". */
async function quickImport(drops: ReturnType<typeof createManualFileDropSource>) {
  fireEvent.click(await screen.findByRole('button', { name: '探索' }))
  await screen.findByRole('heading', { level: 1, name: '探索' })
  act(() => drops.emit({ type: 'drop', paths: ['D:/Downloads/KVK Settings 2025'] }))
  fireEvent.click(await screen.findByRole('button', { name: '加进游戏' }))
  await screen.findByText(/^已加入 \d+ 个文件$/)
}

describe('lists after Quick import', () => {
  it('Theme reads the game again when it is next shown, so the added theme appears', async () => {
    const drops = createManualFileDropSource()
    const bridge = createDemoBridge({ durationMs: 0 })
    render(<Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo fileDrops={drops} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    await screen.findAllByText('Clean Dark')
    expect(screen.queryByText('Aimloom Demo')).toBeNull()
    await quickImport(drops)
    fireEvent.click(screen.getByRole('button', { name: '去「背景」' }))
    expect((await screen.findAllByText('Aimloom Demo')).length).toBeGreaterThan(0)
  })

  it('a pending Theme choice survives the reload', async () => {
    const drops = createManualFileDropSource()
    render(<Workspace bridge={createDemoBridge({ durationMs: 0 })} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo fileDrops={drops} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    fireEvent.click(await screen.findByRole('button', { name: 'snowi clarity 预览' }))
    expect(await screen.findByRole('button', { name: '应用背景' })).toBeEnabled()
    await quickImport(drops)
    fireEvent.click(screen.getByRole('button', { name: '去「背景」' }))
    await screen.findAllByText('Aimloom Demo')
    expect(screen.getByRole('button', { name: '应用背景' })).toBeEnabled()
  })

  it('the Profile theme sheet forgets its cached installed list', async () => {
    const drops = createManualFileDropSource()
    const bridge = createDemoBridge({ durationMs: 0 })
    const themeList = vi.spyOn(bridge, 'themeList')
    render(<Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo fileDrops={drops} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建组合' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme 背景与环境/ }))
    await waitFor(() => expect(themeList).toHaveBeenCalled())
    await screen.findAllByText('Clean Dark')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText('Aimloom Demo')).toBeNull()
    await quickImport(drops)
    const before = themeList.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '更改配置（未保存）' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme 背景与环境/ }))
    await waitFor(() => expect(themeList.mock.calls.length).toBeGreaterThan(before))
    expect((await screen.findAllByText('Aimloom Demo')).length).toBeGreaterThan(0)
  })
})

describe('a blocked window close', () => {
  const blocked = () => act(() => { window.dispatchEvent(new Event('kvk-close-blocked')) })
  it('shows one dialog on any page and Keep open dismisses it', async () => {
    render(<Workspace bridge={createDemoBridge()} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />)
    fireEvent.click(await screen.findByRole('button', { name: '探索' }))
    await screen.findByRole('heading', { level: 1, name: '探索' })
    blocked()
    expect(await screen.findByRole('dialog', { name: '当前操作尚未结束' })).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '保持窗口开启' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows exactly one dialog while 备份与恢复 is open', async () => {
    render(<Workspace bridge={createDemoBridge()} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />)
    fireEvent.click(await screen.findByRole('button', { name: '探索' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开备份与恢复' }))
    await screen.findByRole('heading', { level: 1, name: '从备份恢复配置' })
    blocked()
    expect(await screen.findByRole('dialog', { name: '当前操作尚未结束' })).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('Explore pick errors', () => {
  it('shows a failed pick on the idle view', async () => {
    const bridge = createDemoBridge()
    bridge.pickFiles = async () => { throw new Error('dialog failed') }
    render(<Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />)
    fireEvent.click(await screen.findByRole('button', { name: '探索' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择文件' }))
    expect(await screen.findByText(/无法打开选择窗口/)).toBeVisible()
  })
})
