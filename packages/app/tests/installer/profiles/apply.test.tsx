import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ProfilesApp, type ProfileGameBridge } from '../../../src/profiles/ProfilesApp'
import type { ProfileBridge } from '../../../src/profiles/bridge'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'
import type { TrainingProfile } from '../../../src/profiles/model'
import type { Job, Preview } from '../../../src/installer/contracts'
import { InstallerFailure } from '../../../src/installer/contracts'

const GAME_ROOT = 'D:\\Game'
const scheme = { name: 'Blue Room', path: 'D:\\Game\\FPSAimTrainer\\Saved\\SaveGames\\Themes\\Blue Room.json' }
const killSound = { name: 'Bell5.wav', path: 'D:\\Game\\FPSAimTrainer\\sounds\\Bell5.wav' }

function fullProfile(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return { schemaVersion: 1, id: 'profile1', name: '每日训练', scheme, audio: { kill: [killSound], spawn: [] }, ...overrides }
}
function emptyProfile(): TrainingProfile {
  return { schemaVersion: 1, id: 'profile2', name: '空组合', scheme: null, audio: null }
}
function keepAudioProfile(): TrainingProfile {
  // Every list empty means "keep every event" -- still nothing to apply.
  return { schemaVersion: 1, id: 'profile3', name: '仅保持音效', scheme: null, audio: { kill: [], spawn: [] } }
}

const finishedJob = (status: 'completed' | 'no-change'): Job => ({
  operationId: 'op-1', planId: 'plan-1', state: 'finished', progress: null,
  result: { status, batchId: status === 'completed' ? 'batch-1' : null, items: [], errors: [], errorsEn: [] }, error: null,
})
const preview = (input: { gameRoot: string; revision: number }): Preview => ({
  planId: 'plan-1', revision: input.revision, kind: 'install',
  location: { gameRoot: input.gameRoot, backupRoot: 'C:\\Local\\Aimloom\\backups', gameState: 'closed' },
  packRoot: null, categories: ['primary'], sourceId: null,
  rows: [{ key: 'primary/PrimaryUserSettings.json', category: 'primary', source: null, target: `${input.gameRoot}\\FPSAimTrainer\\Saved\\SaveGames\\PrimaryUserSettings.json`, action: 'replace', conflict: false, unowned: false }],
  skipped: [],
})

function fixtures(profiles: TrainingProfile[] = [fullProfile()]) {
  let library = profiles
  const bridge: ProfileBridge = {
    list: async () => ({ directory: '/profiles', profiles: library, errors: [] }),
    read: async (id: string) => ({ filePath: `/profiles/${id}.json`, profile: structuredClone(library.find(p => p.id === id) ?? null) }),
    save: async profile => { library = [...library.filter(p => p.id !== profile.id), profile]; return { filePath: `/profiles/${profile.id}.json`, profile } },
    delete: async () => ({ deleted: true }),
  }
  const assets: ProfileAssetBridge = { chooseDirectory: async () => null, list: async () => ({ directory: '', files: [], errors: [] }), read: async () => new Uint8Array() }
  const planCalls: { gameRoot: string; id: string; revision: number }[] = []
  const executeCalls: { operationId: string; planId: string; confirmation: string; allowConflicts: boolean }[] = []
  let planImpl: (input: { gameRoot: string; id: string; revision: number }) => Promise<Preview> = async input => preview(input)
  let jobImpl: () => Promise<Job> = async () => finishedJob('completed')
  let reconcileCalls = 0
  const game: ProfileGameBridge = {
    discover: async () => ({ candidates: [GAME_ROOT] }),
    locate: async (root: string) => ({ gameRoot: root }),
    schemeList: async () => ({ directory: '', current: null, themes: [] }),
    audioList: async () => ({ directory: '', sounds: [], bindings: { kill: [], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] } }),
    pickFolder: async () => GAME_ROOT,
    planProfileApply: async input => { planCalls.push(input); return planImpl(input) },
    execute: async input => { executeCalls.push(input); return { operationId: input.operationId, planId: input.planId, state: 'running', progress: null, result: null, error: null } },
    job: async () => jobImpl(),
    reconcile: async () => { reconcileCalls += 1; return {} },
  }
  return {
    bridge, assets, game, planCalls, executeCalls,
    setPlanImpl: (fn: typeof planImpl) => { planImpl = fn },
    setJobImpl: (fn: typeof jobImpl) => { jobImpl = fn },
    reconcileCalls: () => reconcileCalls,
    library: () => library,
  }
}

function localStorageFake() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }
}

describe('applying a saved Profile', () => {
  it('shows 应用 beside 复制 and 删除, disabled with a reason when there is nothing to apply', async () => {
    const f = fixtures([fullProfile(), emptyProfile(), keepAudioProfile()])
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    const applyFull = await screen.findByRole('button', { name: '应用 每日训练' })
    expect(applyFull).toBeEnabled()
    const applyEmpty = screen.getByRole('button', { name: '应用 空组合' })
    expect(applyEmpty).toBeDisabled()
    expect(applyEmpty).toHaveAttribute('title', '这套组合没有可应用的内容')
    const applyKeep = screen.getByRole('button', { name: '应用 仅保持音效' })
    expect(applyKeep).toBeDisabled()
  })

  it('resolves the game folder and calls planProfileApply with the saved id, even after an unsaved draft edit', async () => {
    const f = fixtures()
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    // Open the editor, change the name, then cancel without saving.
    fireEvent.click(await screen.findByRole('button', { name: '编辑 每日训练' }))
    fireEvent.change(await screen.findByLabelText('Profile 名称'), { target: { value: '未保存的改动' } })
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    await screen.findByRole('dialog', { name: '应用「每日训练」' })
    await waitFor(() => expect(f.planCalls).toHaveLength(1))
    expect(f.planCalls[0]).toEqual({ gameRoot: GAME_ROOT, id: 'profile1', revision: 1 })
  })

  it('lists Theme / Sounds as saved, naming the recorded sound files per event', async () => {
    const f = fixtures()
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    const dialog = await screen.findByRole('dialog', { name: '应用「每日训练」' })
    await within(dialog).findByText('Theme · Blue Room')
    // Names, not counts (the user, 2026-09-21): one line per event.
    await within(dialog).findByText('击杀 Bell5.wav')
    expect(within(dialog).getByText(/请先退出 KovaaK/)).toBeVisible()
    expect(within(dialog).getByText(/先备份/)).toBeVisible()
  })

  it('shows 保持当前 for a component the Profile keeps', async () => {
    const f = fixtures([fullProfile({ scheme: null })])
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Theme · 保持当前')
  })

  it('取消 closes the dialog and writes nothing', async () => {
    const f = fixtures()
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.executeCalls).toHaveLength(0)
  })

  it('确认应用 executes with a fresh operationId, locks the dialog while running, and closes on success', async () => {
    const f = fixtures()
    let resolveJob: ((job: Job) => void) | null = null
    f.setJobImpl(() => new Promise(resolve => { resolveJob = resolve }))
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    const confirm = await screen.findByRole('button', { name: '确认应用' })
    fireEvent.click(confirm)
    await waitFor(() => expect(f.executeCalls).toHaveLength(1))
    expect(f.executeCalls[0]!.confirmation).toBe('install')
    expect(f.executeCalls[0]!.allowConflicts).toBe(false)
    expect(f.executeCalls[0]!.operationId).toBeTruthy()
    // Locked while running: the dialog's own confirm is gone, and library rows are unreachable.
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull())
    expect(screen.getByRole('button', { name: '删除 每日训练' })).toBeDisabled()
    resolveJob!(finishedJob('completed'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await screen.findByText('每日训练 已应用；下次启动游戏时生效。')
    expect(screen.getByRole('button', { name: '删除 每日训练' })).toBeEnabled()
  })

  it('a refusal (missing file) shows the Issue and offers no confirm button', async () => {
    const f = fixtures()
    f.setPlanImpl(async () => { throw new InstallerFailure({ code: 'ENGINE_ERROR', message: '「Blue Room.json」不在游戏中，应用被拒绝。', messageEn: 'The Theme file "Blue Room.json" is not in the game, so the application is refused.', path: null }) })
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    await screen.findByText('「Blue Room.json」不在游戏中，应用被拒绝。')
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull()
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
  })

  it('a failed execute spends the plan, so the next 确认应用 runs a fresh one', async () => {
    // The worker clears its plan on every execute. Before this, a stale refusal left Confirm
    // bound to the spent planId and every further click failed the same way.
    const f = fixtures()
    let n = 0
    f.setPlanImpl(async input => ({ ...preview(input), planId: `plan-${++n}` }))
    let fail = true
    f.game.execute = async input => {
      f.executeCalls.push(input)
      if (fail) { fail = false; throw new InstallerFailure({ code: 'PLAN_STALE', message: '预览之后文件发生了变化。', messageEn: 'The file changed after preview.', path: null }) }
      return { operationId: input.operationId, planId: input.planId, state: 'running', progress: null, result: null, error: null }
    }
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认应用' }))
    await screen.findByText('预览之后文件发生了变化。')
    await waitFor(() => expect(f.planCalls).toHaveLength(2))
    fireEvent.click(await screen.findByRole('button', { name: '确认应用' }))
    await waitFor(() => expect(f.executeCalls).toHaveLength(2))
    expect(f.executeCalls.map(call => call.planId)).toEqual(['plan-1', 'plan-2'])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a failed execute whose re-plan is refused shows the refusal and no confirm button', async () => {
    const f = fixtures()
    let first = true
    f.setPlanImpl(async input => {
      if (first) { first = false; return preview(input) }
      throw new InstallerFailure({ code: 'ENGINE_ERROR', message: '「Blue Room.json」不在游戏中，应用被拒绝。', messageEn: 'The Theme file "Blue Room.json" is not in the game, so the application is refused.', path: null })
    })
    f.game.execute = async () => { throw new InstallerFailure({ code: 'PLAN_STALE', message: '预览之后文件发生了变化。', messageEn: 'The file changed after preview.', path: null }) }
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认应用' }))
    await screen.findByText('「Blue Room.json」不在游戏中，应用被拒绝。')
    expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull()
  })

  it('an unknown job keeps the UI locked until 核对结果', async () => {
    const f = fixtures()
    f.setJobImpl(async () => ({ operationId: 'op-1', planId: 'plan-1', state: 'unknown', progress: null, result: null, error: null }))
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认应用' }))
    const reconcile = await screen.findByRole('button', { name: '核对结果' })
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
    expect(screen.getByRole('button', { name: '删除 每日训练' })).toBeDisabled()
    fireEvent.click(reconcile)
    await waitFor(() => expect(f.reconcileCalls()).toBe(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: '删除 每日训练' })).toBeEnabled()
  })

  it('offers the same locate affordance as the sections when no game folder is known', async () => {
    const f = fixtures()
    f.game.discover = async () => ({ candidates: [] })
    render(<ProfilesApp bridge={f.bridge} assets={f.assets} locate={f.game} storage={localStorageFake()} />)
    fireEvent.click(await screen.findByRole('button', { name: '应用 每日训练' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('没有自动找到 KovaaK 目录，请手动选择 FPSAimTrainer 所在的文件夹。')
    fireEvent.click(within(dialog).getByRole('button', { name: '选择文件夹' }))
    await waitFor(() => expect(f.planCalls).toHaveLength(1))
    expect(f.planCalls[0]).toEqual({ gameRoot: GAME_ROOT, id: 'profile1', revision: 1 })
  })
})
