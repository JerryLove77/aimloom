import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../src/workspace/Workspace'
import { createDemoBridge } from '../../src/installer/demo-bridge'
import { createDemoProfileBridge, createDemoAssetBridge } from '../../src/profiles/demo'
import { createManualFileDropSource } from '../../src/workspace/file-drop'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))

// The demo Profile bridge persists to localStorage, so a saving test must not leak into the next.
beforeEach(() => { localStorage.clear() })

const tree = () => <Workspace bridge={createDemoBridge()} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />

describe('five-section workspace', () => {
  it('exposes all five sections, each available', async () => {
    render(tree())
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['Profile', 'Theme', 'Sounds', 'Crosshair', 'Enemy'])
    for (const button of buttons) expect(button).toBeEnabled()
  })

  it('groups the sidebar into 组合管理 and 当前配置', async () => {
    render(tree())
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    expect(within(nav).getByText('组合管理')).toBeVisible()
    expect(within(nav).getByText('当前配置')).toBeVisible()
  })

  it('renders every page inside one light workspace root with a header and the demo note', async () => {
    render(tree())
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading.closest('.profiles-app')).not.toBeNull()
    expect(within(heading.closest('.ws-header') as HTMLElement).getByText('PROFILE · 配置库')).toBeVisible()
  })

  it('shows one demo note per section, worded for that section', async () => {
    render(tree())
    // Profile does save in the browser demo, so the generic game-file wording would mislead there.
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByText(/^演示模式：/)).toHaveLength(1)
    expect(screen.getByText('演示模式：保存仅保留在此浏览器，文件列表使用演示素材。')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(await screen.findByText('演示模式：不会修改任何游戏文件。')).toBeVisible()
    expect(screen.getAllByText(/^演示模式：/)).toHaveLength(1)
  })

  it('keeps an unfinished Profile draft across a visit to the Enemy section', async () => {
    render(tree())
    fireEvent.click(await screen.findByRole('button', { name: '新建组合' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '敌人草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enemy' }))
    expect(await screen.findByRole('heading', { level: 1, name: '敌人皮肤' })).toBeVisible()
    // The draft is unsaved, so the sidebar entry says so.
    fireEvent.click(screen.getByRole('button', { name: 'Profile（未保存）' }))
    expect(await screen.findByLabelText('Profile 名称')).toHaveValue('敌人草稿')
  })

  it('keeps an unfinished Profile draft when the Theme section is used and Profile returns', async () => {
    render(tree())
    fireEvent.click(await screen.findByRole('button', { name: '新建组合' }))
    const name = await screen.findByLabelText('Profile 名称')
    fireEvent.change(name, { target: { value: '未保存的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(await screen.findByRole('heading', { level: 1, name: '背景' })).toBeVisible()
    expect(screen.queryByLabelText('Profile 名称')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Profile（未保存）' }))
    const restored = await screen.findByLabelText('Profile 名称')
    expect(restored).toHaveValue('未保存的草稿')
  })

  it('applies a scheme in the browser demo without touching a Profile', async () => {
    render(<Workspace bridge={createDemoBridge({ durationMs: 0 })} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />)
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    fireEvent.click(await screen.findByRole('button', { name: 'snowi clarity 预览' }))
    // Selecting only previews. Nothing is written until the page's own primary action.
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '应用背景' }))
    expect(await screen.findByRole('status', { name: '操作结果' }, { timeout: 3000 })).toHaveTextContent('下次启动 KovaaK 生效')
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用snowi clarity')
  })

  it('lists the current sound bindings on the Audio section and keeps the Profile draft', async () => {
    render(tree())
    fireEvent.click(await screen.findByRole('button', { name: '新建组合' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '音效草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sounds' }))
    expect(await screen.findByRole('heading', { level: 1, name: '音效' })).toBeVisible()
    expect(screen.getByRole('button', { name: /^击杀音效/ })).toHaveAccessibleName(/当前：saya_kick_deeper、Bell5/)
    expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('saya_kick_deeper')
    // The draft is unsaved, so the sidebar entry says so.
    fireEvent.click(screen.getByRole('button', { name: 'Profile（未保存）' }))
    expect(await screen.findByLabelText('Profile 名称')).toHaveValue('音效草稿')
  })

  it('renders real previews for the game-side pages in the browser demo', async () => {
    // The demo game paths must be readable, or every thumbnail shows 无法预览.
    render(tree())
    for (const [section, label] of [['Theme', 'Clean Dark 预览'], ['Crosshair', 'dot.png']] as const) {
      fireEvent.click(await screen.findByRole('button', { name: section }))
      const card = await screen.findByRole('button', { name: label })
      await waitFor(() => expect(card.querySelector('img')).not.toBeNull())
      // Every card, not just the first: one sample name can hide a generator that fails for others.
      const grid = card.parentElement!
      await waitFor(() => {
        const cards = [...grid.querySelectorAll('button')].filter(button => !button.hasAttribute('disabled'))
        expect(cards.length).toBeGreaterThan(1)
        for (const each of cards) expect(each.textContent, each.getAttribute('aria-label') ?? '').not.toMatch(/无法预览|…/)
      })
    }
  })

  it('renders every dialog inside the wrapper that defines the design tokens', async () => {
    // The dialog styles read --ki-* variables declared on .kvk-installer. A dialog rendered
    // outside that wrapper loses its panel and backdrop and draws its text over the page.
    render(<Workspace bridge={createDemoBridge({ durationMs: 0 })} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo />)
    const opened: [string, string][] = [
      ['Profile', '删除 日常跟枪'],
      // Theme, Sounds and Enemy select and apply inline; their only dialog is the add sheet.
      // Crosshair's PNG card opens its add sheet after the (demo) file dialog. Enemy has no
      // add sheet: its skins come from the game's own fixed catalog.
      ['Theme', '添加主题…'],
      ['Sounds', '添加音效…'],
      ['Crosshair', '拖入或选择 PNG'],
    ]
    for (const [section, trigger] of opened) {
      fireEvent.click(await screen.findByRole('button', { name: section }))
      fireEvent.click(await screen.findByRole('button', { name: trigger }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.closest('.kvk-installer'), `${section} dialog is outside the token wrapper`).not.toBeNull()
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
  })

  it('hands a dropped file to the active section only, and adds it through the demo engine', async () => {
    const drops = createManualFileDropSource()
    const bridge = createDemoBridge({ durationMs: 0 })
    render(<Workspace bridge={bridge} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo fileDrops={drops} />)
    // On Profile, a theme is not added: the player is told where it goes. One toast, no sheet.
    await screen.findByRole('button', { name: '编辑 日常跟枪' })
    act(() => drops.emit({ type: 'drop', paths: ['/demo/downloads/Night-arena.json'] }))
    expect(await screen.findAllByRole('status', { name: '操作结果' })).toHaveLength(1)
    expect(screen.getByRole('status', { name: '操作结果' })).toHaveTextContent(/Theme 栏目/)
    expect(screen.queryByRole('dialog')).toBeNull()
    // On Scheme, the same drop opens the add sheet; confirming adds the file and selects it.
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await screen.findByRole('button', { name: '添加主题…' })
    act(() => drops.emit({ type: 'drop', paths: ['/demo/downloads/Night-arena.json'] }))
    const sheet = await screen.findByRole('dialog', { name: '添加主题到游戏' })
    expect(sheet.closest('.kvk-installer')).not.toBeNull()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '添加到游戏' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: 'Night-arena 预览' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores dropped files while the legacy installer is open', async () => {
    const drops = createManualFileDropSource()
    render(<Workspace bridge={createDemoBridge({ durationMs: 0 })} profileBridge={createDemoProfileBridge()} assetBridge={createDemoAssetBridge()} isDemo fileDrops={drops} />)
    fireEvent.click(await screen.findByRole('button', { name: '一键拖入' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '编辑 日常跟枪' })).toBeNull())
    act(() => drops.emit({ type: 'enter', paths: ['/demo/downloads/Night-arena.json'] }))
    act(() => drops.emit({ type: 'drop', paths: ['/demo/downloads/Night-arena.json'] }))
    expect(document.querySelector('.ws-drop-overlay')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('status', { name: '操作结果' })).toBeNull()
  })

  it('lists the game themes on the Theme section without writing a Profile', async () => {
    render(tree())
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    expect(await screen.findByRole('button', { name: 'Clean Dark 预览' })).toBeVisible()
    expect(screen.getByText('演示模式：不会修改任何游戏文件。')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用Clean Dark'))
  })
})

/**
 * The three acceptance flows. They are the contract for "what does each button touch":
 * a Profile edit never reaches the game, a game apply never reaches a Profile, and
 * cancelling one scope never undoes another. If one fails, fix the product, not the flow.
 */
describe('acceptance flows', () => {
  it('flow 1: cancelling a Profile edit does not undo other sections', async () => {
    const profileBridge = createDemoProfileBridge()
    render(<Workspace bridge={createDemoBridge({ durationMs: 0 })} profileBridge={profileBridge} assetBridge={createDemoAssetBridge()} isDemo />)
    const before = JSON.stringify((await profileBridge.read('daily')).profile)

    // Apply a background to the game.
    fireEvent.click(await screen.findByRole('button', { name: 'Theme' }))
    fireEvent.click(await screen.findByRole('button', { name: 'snowi clarity 预览' }))
    fireEvent.click(screen.getByRole('button', { name: '应用背景' }))
    await waitFor(() => expect(screen.getByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用snowi clarity'), { timeout: 5000 })

    // Start an unrelated Profile edit.
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme 背景/ }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('radio', { name: /不记录背景/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: '用于此组合' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Profile（未保存）' })).toBeVisible())

    // Apply a sound to the game while that draft is open.
    fireEvent.click(screen.getByRole('button', { name: 'Sounds' }))
    // The demo's kill binding already holds two sounds, so the list editor is open by itself.
    fireEvent.click(await screen.findByRole('button', { name: '加入 hit' }))
    fireEvent.click(screen.getByRole('button', { name: '应用音效' }))
    expect(await screen.findByRole('status', { name: '操作结果' }, { timeout: 5000 })).toHaveTextContent('已更新击杀音效')

    // The draft survived the trip, and cancelling it writes nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Profile（未保存）' }))
    expect(await screen.findByRole('button', { name: /^Theme 背景.*保持当前/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Profile' })).toBeVisible())
    expect(JSON.stringify((await profileBridge.read('daily')).profile)).toBe(before)

    // Cancelling the Profile did not undo the game change.
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(await screen.findByRole('group', { name: '配置状态' })).toHaveTextContent('当前使用snowi clarity')
  })

  it('flow 2: cancelling a sheet keeps the rest of the draft', async () => {
    render(tree())
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '日常跟枪 精准' } })
    fireEvent.click(screen.getByRole('button', { name: /^Theme 背景/ }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('radio', { name: /不记录背景/ }))
    fireEvent.keyDown(sheet, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Only the sheet's own temporary choice is discarded.
    expect(screen.getByLabelText('Profile 名称')).toHaveValue('日常跟枪 精准')
    expect(screen.getByRole('button', { name: /^Theme 背景/ })).toHaveTextContent('Blue-room.json')
  })

  it('flow 3: saving a Profile writes JSON and applies nothing', async () => {
    const bridge = createDemoBridge({ durationMs: 0 })
    const plans: string[] = []
    for (const key of ['planScheme', 'planAudio', 'planEnemy', 'planCrosshair', 'planCrosshairAdd', 'planFileAdd'] as const) {
      const original = (bridge as unknown as Record<string, (...args: unknown[]) => unknown>)[key]!.bind(bridge)
      ;(bridge as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => { plans.push(key); return original(...args) }
    }
    const profileBridge = createDemoProfileBridge()
    render(<Workspace bridge={bridge} profileBridge={profileBridge} assetBridge={createDemoAssetBridge()} isDemo />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '日常跟枪 已保存' } })
    fireEvent.click(screen.getByRole('button', { name: '保存组合' }))
    expect(await screen.findByText(/日常跟枪 已保存 已保存 · 当前游戏配置未改变/)).toBeVisible()
    expect((await profileBridge.read('daily')).profile?.name).toBe('日常跟枪 已保存')
    // Saving a Profile plans no game write at all.
    expect(plans).toEqual([])
  })
})
