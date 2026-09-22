import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProfilesApp } from '../../../src/profiles/ProfilesApp'
import { Workspace } from '../../../src/workspace/Workspace'
import { createDemoBridge } from '../../../src/installer/demo-bridge'
import { createDemoProfileBridge, createDemoAssetBridge } from '../../../src/profiles/demo'
import { createTrainingProfile } from '../../../src/profiles/model'
import type { ProfileBridge } from '../../../src/profiles/bridge'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { Job } from '../../../src/installer/contracts'

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-preview'), revokeObjectURL: vi.fn() }))
  localStorage.clear()
})

/** The browser-demo workspace, whose 日常跟枪 profile already references every component. */
function renderProfiles(options: { onSave?: (profile: unknown) => void } = {}) {
  const profileBridge = createDemoProfileBridge()
  const save = profileBridge.save.bind(profileBridge)
  profileBridge.save = async profile => { options.onSave?.(profile); return save(profile) }
  return render(<Workspace bridge={createDemoBridge()} profileBridge={profileBridge} assetBridge={createDemoAssetBridge()} isDemo />)
}
const original = () => createTrainingProfile('profile1', '每日训练')
function fixtures(failSave = false, initial = original()) {
  let stored = initial
  const save = vi.fn(async (profile: ReturnType<typeof original>) => {
    if (failSave) throw new Error('保存失败，请重试')
    stored = structuredClone(profile)
    return { filePath: '/profiles/profile1.json', profile: stored }
  })
  const bridge: ProfileBridge = { list: async () => ({ directory: '/profiles', profiles: [stored], errors: [] }), read: async () => ({ filePath: '/profiles/profile1.json', profile: structuredClone(stored) }), save, delete: async () => ({ deleted: true }) }
  const assets: ProfileAssetBridge = { chooseDirectory: async () => '/assets', list: async () => ({ directory: '/assets', files: [{ name: 'Blue.json', path: '/assets/Blue.json' }], errors: [] }), read: async () => new TextEncoder().encode(JSON.stringify({ themeName: 'Blue', wallMaterial: 'DRYWALL', floorMaterial: 'DRYWALL', wallTint: {x:0.1,y:0.3,z:0.8} })) }
  return { bridge, assets, save, stored: () => stored }
}
describe('Profile page', () => {
  it('shows five sections and cancels only the Profile draft', async () => {
    const f = fixtures(); render(<ProfilesApp bridge={f.bridge} assets={f.assets} />)
    await screen.findByRole('button', { name: '编辑 每日训练' })
    expect(screen.getByRole('navigation', { name: '主导航' }).querySelectorAll('button')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '编辑 每日训练' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '未保存' } })
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    await screen.findByRole('button', { name: '编辑 每日训练' })
    expect(f.save).not.toHaveBeenCalled(); expect(f.stored().name).toBe('每日训练')
  })
  it('only final save persists a renamed Profile and returns to the library', async () => {
    const f = fixtures(); render(<ProfilesApp bridge={f.bridge} assets={f.assets} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑 每日训练' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '跟枪训练' } })
    fireEvent.click(screen.getByRole('button', { name: '保存组合' }))
    await screen.findByRole('button', { name: '编辑 跟枪训练' })
    expect(f.save).toHaveBeenCalledTimes(1)
  })
  it('keeps entered values and the editor open when save fails', async () => {
    const f = fixtures(true); render(<ProfilesApp bridge={f.bridge} assets={f.assets} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑 每日训练' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '保留输入' } })
    fireEvent.click(screen.getByRole('button', { name: '保存组合' }))
    await screen.findByText('保存失败，请重试')
    expect(screen.getByLabelText('Profile 名称')).toHaveValue('保留输入')
  })
  it('opens the drive root when the existing reference sits at a root-level path', async () => {
    const profile = { ...original(), scheme: { name: 'Root', path: 'C:/root.json' } }
    const f = fixtures(false, profile); const list = vi.spyOn(f.assets, 'list')
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑 每日训练' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme 背景/ }))
    await waitFor(() => expect(list).toHaveBeenCalledWith('scheme', 'C:/'))
  })
  it('stages a decoded file in the draft, and cancelling the edit leaves the saved file unchanged', async () => {
    const f = fixtures(); render(<ProfilesApp bridge={f.bridge} assets={f.assets} />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑 每日训练' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme 背景/ }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: '选择文件夹' }))
    fireEvent.click(await within(sheet).findByRole('radio', { name: /Blue\.json/ }))
    // A file choice is only confirmable once its preview decoded.
    expect(within(sheet).getByRole('button', { name: '用于此组合' })).toBeDisabled()
    const preview = await within(sheet).findByRole('img', { name: 'Blue.json预览' })
    Object.defineProperties(preview, { naturalWidth: { value: 1152 }, naturalHeight: { value: 768 } })
    fireEvent.load(preview)
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '用于此组合' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '用于此组合' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Theme 背景/ })).toHaveTextContent('Blue.json')
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    expect(f.stored().scheme).toBeNull()
  })

  it('disables 保存组合 until the draft changes', async () => {
    renderProfiles()
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    const save = await screen.findByRole('button', { name: '保存组合' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Profile 名称'), { target: { value: '日常跟枪 2' } })
    expect(save).toBeEnabled()
    // Both markers are intended: the tag beside the title, and the sidebar's own hint.
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('未保存')
    expect(screen.getByRole('button', { name: 'Profile（未保存）' })).toBeVisible()
  })

  it('sheet cancel discards only the temporary choice and returns focus to the slot', async () => {
    renderProfiles()
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '日常跟枪 精准' } })
    const slot = screen.getByRole('button', { name: /^Theme 背景/ })
    slot.focus(); fireEvent.click(slot)
    const sheet = await screen.findByRole('dialog', { name: '为 日常跟枪 精准 选择背景' })
    expect(sheet).toHaveClass('ki-sheet')
    fireEvent.click(within(sheet).getByRole('radio', { name: /不记录背景/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The draft edit survives; only the sheet's own temporary choice is gone.
    expect(screen.getByLabelText('Profile 名称')).toHaveValue('日常跟枪 精准')
    expect(slot).toHaveTextContent('Blue-room.json')
    await waitFor(() => expect(slot).toHaveFocus())
  })

  it('audio sheet edits per-event lists and confirms into the draft only', async () => {
    const saves: unknown[] = []
    renderProfiles({ onSave: profile => saves.push(profile) })
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Sounds 音效/ }))
    const sheet = await screen.findByRole('dialog', { name: '为 日常跟枪 选择音效' })
    fireEvent.change(within(sheet).getByLabelText('音效事件'), { target: { value: 'spawn' } })
    fireEvent.click(within(sheet).getByRole('radio', { name: /不使用音效/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: '用于此组合' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saves).toEqual([])
    expect(screen.getByRole('button', { name: '保存组合' })).toBeEnabled()
  })

  it('audio sheet cancel leaves the audio component unchanged', async () => {
    renderProfiles()
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Sounds 音效/ }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('radio', { name: /保持当前/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: '保存组合' })).toBeDisabled()
  })

  it('用于此组合 writes the choice into the draft only', async () => {
    const saves: unknown[] = []
    renderProfiles({ onSave: profile => saves.push(profile) })
    fireEvent.click(await screen.findByRole('button', { name: '编辑 日常跟枪' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme 背景/ }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('radio', { name: /不记录背景/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: '用于此组合' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: /^Theme 背景/ })).toHaveTextContent('保持当前')
    expect(saves).toEqual([])
    expect(screen.getByRole('button', { name: '保存组合' })).toBeEnabled()
  })
})

// The friend's screenshot: 更改 opened on an empty list above "先选择存放文件的文件夹", so the
// player had to go and find the game before they could pick anything. A sheet now shows what the
// game already has, as the same previewed grid the section shows.
describe('a resource sheet shows what the game already has', () => {
  const themes = [
    { name: 'Blue Room', file: 'Blue Room.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/Blue Room.json', readable: true, duplicateName: false },
    { name: 'Night', file: 'Night.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/Night.json', readable: true, duplicateName: false },
  ]
  function gameBridge(options: { candidates?: string[]; fails?: boolean; pickPath?: string | null; planFileAdd?: () => Promise<{ planId: string }>; execute?: () => Promise<Job>; job?: () => Promise<Job> } = {}) {
    const seen: string[] = []
    return {
      seen,
      discover: async () => ({ candidates: options.candidates ?? ['D:/Game'] }),
      locate: async (gameRoot: string) => ({ gameRoot }),
      schemeList: async (gameRoot: string) => {
        seen.push(`schemeList:${gameRoot}`)
        if (options.fails) throw new Error('the engine refused')
        return { directory: `${gameRoot}/Themes`, current: 'Blue Room', themes }
      },
      audioList: async () => ({ directory: '', sounds: [], bindings: { kill: [], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] } }),
      // These tests never open the apply dialog; stubs just satisfy ProfileGameBridge's shape.
      pickFolder: async () => null,
      planProfileApply: async () => { throw new Error('not used by these tests') },
      execute: options.execute ?? (async () => { throw new Error('not used by these tests') }),
      job: options.job ?? (async () => { throw new Error('not used by these tests') }),
      reconcile: async () => { throw new Error('not used by these tests') },
      planFileAdd: options.planFileAdd ?? (async () => { throw new Error('not used by these tests') }),
      pickFile: async () => (options.pickPath !== undefined ? options.pickPath : null),
      launchGame: async () => { throw new Error('not used by these tests') },
    }
  }

  it('lists the game\'s themes, marking the one in use', async () => {
    const f = fixtures()
    const game = gameBridge()
    render(<ProfilesApp bridge={f.bridge} assets={createDemoAssetBridge()} locate={game} />)
    fireEvent.click(await screen.findByRole('button', { name: '\u7f16\u8f91 \u6bcf\u65e5\u8bad\u7ec3' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme \u80cc\u666f/ }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('button', { name: /Blue Room/ })
    await within(dialog).findByRole('button', { name: /Night/ })
    // The page also reads the game's current theme for 「保持当前」; every read is of this game.
    expect(new Set(game.seen)).toEqual(new Set(['schemeList:D:/Game']))
    // The folder prompt that started all this is gone from this sheet.
    expect(dialog.textContent).not.toMatch(/\u5148\u9009\u62e9\u5b58\u653e\u6587\u4ef6\u7684\u6587\u4ef6\u5939/)
  })

  it('records the theme the player picks, and changes nothing in the game', async () => {
    const f = fixtures()
    render(<ProfilesApp bridge={f.bridge} assets={createDemoAssetBridge()} locate={gameBridge()} />)
    fireEvent.click(await screen.findByRole('button', { name: '\u7f16\u8f91 \u6bcf\u65e5\u8bad\u7ec3' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme \u80cc\u666f/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: /Night/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '\u7528\u4e8e\u6b64\u7ec4\u5408' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Nothing was saved and nothing was applied: only the draft moved.
    expect(f.save).not.toHaveBeenCalled()
  })

  it('falls back to browsing a folder when the game\'s list cannot be read', async () => {
    const f = fixtures()
    render(<ProfilesApp bridge={f.bridge} assets={createDemoAssetBridge()} locate={gameBridge({ fails: true })} />)
    fireEvent.click(await screen.findByRole('button', { name: '\u7f16\u8f91 \u6bcf\u65e5\u8bad\u7ec3' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme \u80cc\u666f/ }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('searchbox')
  })
})

// PF-ADD: the Profile sheet gets the same "add from my computer" chain the Theme and Sounds
// pages already use -- pick, preview, \u6dfb\u52a0\u5230\u6e38\u620f through planFileAdd, and only then can the new
// file be chosen for the draft. The sheet opens the add sheet as a second, nested Dialog rather
// than swapping itself out, so the sheet's own in-progress choice is never touched.
describe('adding a file to a Profile sheet from my computer', () => {
  const initialThemes = [
    { name: 'Blue Room', file: 'Blue Room.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/Blue Room.json', readable: true, duplicateName: false },
  ]
  const addedTheme = { name: 'Blue', file: 'New Theme.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/New Theme.json', readable: true, duplicateName: false }
  function gameWithAdd(options: { pickPath?: string | null; planFileAdd?: () => Promise<{ planId: string }>; jobUnknown?: boolean; reconcileAdds?: boolean; reconcileFails?: boolean } = {}) {
    let added = false
    const planCalls: unknown[] = []
    const executeCalls: unknown[] = []
    const reconcileCalls: string[] = []
    const game = {
      discover: async () => ({ candidates: ['D:/Game'] }),
      locate: async (gameRoot: string) => ({ gameRoot }),
      schemeList: async (gameRoot: string) => ({ directory: `${gameRoot}/Themes`, current: 'Blue Room', themes: added ? [...initialThemes, addedTheme] : initialThemes }),
      audioList: async () => ({ directory: '', sounds: [], bindings: { kill: [], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] } }),
      pickFolder: async () => null,
      planProfileApply: async () => { throw new Error('not used by these tests') },
      execute: async (input: unknown): Promise<Job> => { executeCalls.push(input); return { operationId: 'op', planId: 'plan-add', state: 'finished', progress: null, result: { status: 'completed' as const, batchId: null, items: [], errors: [], errorsEn: [] }, error: null } },
      job: async (): Promise<Job> => (options.jobUnknown
        ? { operationId: 'op', planId: 'plan-add', state: 'unknown', progress: null, result: null, error: null }
        : { operationId: 'op', planId: 'plan-add', state: 'finished', progress: null, result: { status: 'completed' as const, batchId: null, items: [], errors: [], errorsEn: [] }, error: null }),
      // Reconciling the real add: the engine's own answer to "did it actually write". The test
      // controls it directly, exactly as the real one could come back either way.
      reconcile: async (operationId: string) => {
        reconcileCalls.push(operationId)
        if (options.reconcileFails) throw new Error('无法核对，请稍后重试')
        if (options.reconcileAdds) added = true
        return {}
      },
      planFileAdd: options.planFileAdd ?? (async (input: unknown) => { planCalls.push(input); if (!options.jobUnknown) added = true; return { planId: 'plan-add' } }),
      pickFile: async () => (options.pickPath !== undefined ? options.pickPath : 'C:/Users/Player1/Downloads/New Theme.json'),
      launchGame: async () => { throw new Error('not used by these tests') },
    }
    return { game, planCalls, executeCalls, reconcileCalls }
  }
  async function openThemeSheet(f: ReturnType<typeof fixtures>, game: ReturnType<typeof gameWithAdd>['game']) {
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={game} />)
    fireEvent.click(await screen.findByRole('button', { name: '\u7f16\u8f91 \u6bcf\u65e5\u8bad\u7ec3' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Theme \u80cc\u666f/ }))
    return screen.findByRole('dialog')
  }

  it('picks, previews and adds a file through planFileAdd; the new file can then be chosen', async () => {
    const f = fixtures()
    const { game, planCalls, executeCalls } = gameWithAdd()
    const sheet = await openThemeSheet(f, game)
    await within(sheet).findByRole('button', { name: /Blue Room/ })
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6dfb\u52a0\u4e3b\u9898\u2026' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const dialogs = screen.getAllByRole('dialog') // the Profile sheet stays open behind the nested add sheet
    const addSheet = dialogs[1]!
    await waitFor(() => expect(within(addSheet).getByRole('button', { name: '\u6dfb\u52a0\u5230\u6e38\u620f' })).toBeEnabled())
    fireEvent.click(within(addSheet).getByRole('button', { name: '\u6dfb\u52a0\u5230\u6e38\u620f' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(planCalls).toEqual([{ gameRoot: 'D:/Game', kind: 'theme', sourcePath: 'C:/Users/Player1/Downloads/New Theme.json', sourceSha256: expect.any(String), file: 'New Theme.json', revision: 1 }])
    expect(executeCalls).toHaveLength(1)
    // The refreshed installed list now shows the added file, selectable for the draft.
    const added = await within(sheet).findByRole('button', { name: 'Blue 预览' })
    fireEvent.click(added)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u7528\u4e8e\u6b64\u7ec4\u5408' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.save).not.toHaveBeenCalled()
  })

  it('shows the same refusal message the page shows, and writes nothing', async () => {
    const f = fixtures()
    const refuse = async (): Promise<never> => { throw new Error('\u6587\u4ef6\u540d\u5df2\u88ab\u5360\u7528') }
    const { game, executeCalls } = gameWithAdd({ planFileAdd: refuse })
    const sheet = await openThemeSheet(f, game)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6dfb\u52a0\u4e3b\u9898\u2026' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const addSheet = screen.getAllByRole('dialog')[1]!
    await waitFor(() => expect(within(addSheet).getByRole('button', { name: '\u6dfb\u52a0\u5230\u6e38\u620f' })).toBeEnabled())
    fireEvent.click(within(addSheet).getByRole('button', { name: '\u6dfb\u52a0\u5230\u6e38\u620f' }))
    // The sheet reuses the same refusal-message code path the pages do (addFileToGame), so the
    // engine's own message surfaces unchanged.
    expect(await within(addSheet).findByText('文件名已被占用')).toBeVisible()
    expect(executeCalls).toEqual([])
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
  })

  it('cancelling the add sheet writes nothing and returns to the Profile sheet unchanged', async () => {
    const f = fixtures()
    const { game, planCalls } = gameWithAdd()
    const sheet = await openThemeSheet(f, game)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6dfb\u52a0\u4e3b\u9898\u2026' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const addSheet = screen.getAllByRole('dialog')[1]!
    fireEvent.click(within(addSheet).getByRole('button', { name: '\u53d6\u6d88' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(planCalls).toEqual([])
    // The Profile sheet itself is untouched: still on the same list, nothing chosen.
    await within(sheet).findByRole('button', { name: /Blue Room/ })
  })

  // CLAUDE.md: "`unknown` is never success ... The UI stays locked until [reconciled]."
  async function addUntilUnknown(f: ReturnType<typeof fixtures>, game: ReturnType<typeof gameWithAdd>['game']) {
    const sheet = await openThemeSheet(f, game)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6dfb\u52a0\u4e3b\u9898\u2026' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const addSheet = screen.getAllByRole('dialog')[1]!
    await waitFor(() => expect(within(addSheet).getByRole('button', { name: '\u6dfb\u52a0\u5230\u6e38\u620f' })).toBeEnabled())
    fireEvent.click(within(addSheet).getByRole('button', { name: '\u6dfb\u52a0\u5230\u6e38\u620f' }))
    // An unknown result closes the nested add sheet and locks the Profile sheet behind it.
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    return sheet
  }

  it('an unknown add result locks the sheet and offers \u6838\u5bf9\u7ed3\u679c, disabling choosing and \u7528\u4e8e\u6b64\u7ec4\u5408', async () => {
    const f = fixtures()
    const { game } = gameWithAdd({ jobUnknown: true })
    const sheet = await addUntilUnknown(f, game)
    const reconcileButton = await within(sheet).findByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' })
    expect(reconcileButton).toBeEnabled()
    // The same page-level unknown wording, and the same "\u70b9\u300c\u6838\u5bf9\u7ed3\u679c\u300d" instruction.
    expect(within(sheet).getByText(/\u6dfb\u52a0\u7ed3\u679c\u672a\u77e5/)).toBeVisible()
    expect(within(sheet).getByRole('button', { name: '\u7528\u4e8e\u6b64\u7ec4\u5408' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: '\u53d6\u6d88' })).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: 'Blue Room \u9884\u89c8' })).toBeNull()
    // The whole Profile page locks too: Save and \u53d6\u6d88\u7f16\u8f91 stay disabled while unresolved.
    expect(screen.getByRole('button', { name: '\u4fdd\u5b58\u7ec4\u5408' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '\u53d6\u6d88\u7f16\u8f91' })).toBeDisabled()
  })

  it('reconciling to "added" shows the new file, selectable, and unlocks the sheet', async () => {
    const f = fixtures()
    const { game, reconcileCalls } = gameWithAdd({ jobUnknown: true, reconcileAdds: true })
    const sheet = await addUntilUnknown(f, game)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' }))
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' })).toBeNull())
    expect(reconcileCalls).toHaveLength(1)
    const added = await within(sheet).findByRole('button', { name: 'Blue \u9884\u89c8' })
    fireEvent.click(added)
    expect(within(sheet).getByRole('button', { name: '\u7528\u4e8e\u6b64\u7ec4\u5408' })).toBeEnabled()
    fireEvent.click(within(sheet).getByRole('button', { name: '\u7528\u4e8e\u6b64\u7ec4\u5408' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: '\u4fdd\u5b58\u7ec4\u5408' })).toBeEnabled()
  })

  it('reconciling to "not added" shows nothing new and unlocks the sheet', async () => {
    const f = fixtures()
    const { game, reconcileCalls } = gameWithAdd({ jobUnknown: true, reconcileAdds: false })
    const sheet = await addUntilUnknown(f, game)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' }))
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' })).toBeNull())
    expect(reconcileCalls).toHaveLength(1)
    await within(sheet).findByRole('button', { name: /Blue Room/ })
    expect(within(sheet).queryByRole('button', { name: 'Blue \u9884\u89c8' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: '\u53d6\u6d88' })).toBeEnabled()
  })

  it('a failed reconcile keeps the sheet locked so the player can retry \u6838\u5bf9\u7ed3\u679c', async () => {
    const f = fixtures()
    const { game } = gameWithAdd({ jobUnknown: true, reconcileFails: true })
    const sheet = await addUntilUnknown(f, game)
    fireEvent.click(within(sheet).getByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' }))
    expect(await within(sheet).findByText('\u65e0\u6cd5\u6838\u5bf9\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5')).toBeVisible()
    expect(within(sheet).getByRole('button', { name: '\u6838\u5bf9\u7ed3\u679c' })).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: '\u7528\u4e8e\u6b64\u7ec4\u5408' })).toBeDisabled()
  })
})
