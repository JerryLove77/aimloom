import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDemoBridge } from '../../../src/bridge/demo'
import type { Job } from '../../../src/bridge/contracts'
import { createSection, IDLE_SECTION } from '../../../src/section/controller'
import { createApplyController } from '../../../src/profiles/apply-controller'
import { createImportController } from '../../../src/explore/import-controller'
import { renderMsg } from '../../../src/i18n'

const failure = { code: 'ENGINE_ERROR' as const, message: '写入失败，文件不可用。', messageEn: 'Writing failed; the file is unavailable.', path: null }
const PACK = 'C:/Users/Player1/Downloads/Pack'

function fixture() {
  const bridge = createDemoBridge({ durationMs: 0 })
  let cached: Job
  const execute = vi.spyOn(bridge, 'execute').mockImplementation(async input => {
    cached = { ...input, state: 'failed', progress: null, result: null, error: failure }
    return { ...cached, state: 'running', error: null }
  })
  const poll = vi.spyOn(bridge, 'job').mockRejectedValue(new Error('IPC query failed'))
  const reconcile = vi.spyOn(bridge, 'reconcile').mockImplementation(async () => ({ job: cached, backups: null }))
  return { bridge, execute, poll, reconcile, setJob: (patch: Partial<Job>) => { cached = { ...cached, ...patch } } }
}

async function sectionSetup(f: ReturnType<typeof fixture>) {
  const ctl = createSection(f.bridge, null, {
    initial: { ...IDLE_SECTION, draft: 'pending' as string | null },
    keys: { locate: 'theme.error.locate', readDirectory: 'theme.error.readDirectory', chooseFolder: 'theme.error.chooseFolder', list: 'theme.error.listThemes', reconciled: 'theme.applied.reconciled', reconcileFailed: 'theme.error.reconcileFailed' },
    list: async () => ({}),
    onReconciled: { draft: null as string | null },
  })
  await ctl.load()
  const apply = ctl.apply({
    plan: async () => ({ planId: 'plan' }),
    keys: { unresolved: 'theme.error.unresolved', failed: 'theme.error.applyFailed', incomplete: 'theme.error.incomplete', failedGeneric: 'theme.error.applyFailedGeneric' },
    done: () => ({ draft: '' }),
  })
  await vi.runAllTimersAsync()
  await apply
  return ctl
}

describe('reconciling cached failures after status queries fail', () => {
  afterEach(() => vi.useRealTimers())

  it.each(['failed', 'reconciled'] as const)('sections retain the reason from a %s job without clearing drafts', async state => {
    vi.useFakeTimers()
    const f = fixture()
    const ctl = await sectionSetup(f)
    expect(f.poll).toHaveBeenCalledTimes(3)
    expect(ctl.getState().unresolved).toBe(true)
    f.setJob({ state })
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ unresolved: false, message: null, draft: 'pending', error: { zh: failure.message, en: failure.messageEn } })
    expect(f.execute).toHaveBeenCalledOnce()
  })

  it('sections keep a fallback for a failed job without an Issue', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const ctl = await sectionSetup(f)
    f.setJob({ error: null })
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ unresolved: false, message: null, error: { key: 'theme.error.reconcileFailed' } })
  })

  it.each(['rolled-back', 'recovery-required'] as const)('sections preserve drafts and the incomplete %s outcome', async status => {
    vi.useFakeTimers()
    const f = fixture()
    const ctl = await sectionSetup(f)
    f.setJob({ state: 'finished', error: null, result: { status, batchId: null, items: [], errors: [], errorsEn: [] } })
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ unresolved: false, message: null, draft: 'pending', error: { key: 'theme.error.incomplete', params: { status } } })
  })

  it.each(['rolled-back', 'recovery-required'] as const)('Profile retains the incomplete %s result and a fresh preview', async status => {
    vi.useFakeTimers()
    const f = fixture()
    const plan = vi.spyOn(f.bridge, 'planProfileApply').mockImplementation(input => f.bridge.planImport({ ...input, paths: [PACK], includeSettings: false }))
    const ctl = createApplyController(f.bridge, null)
    await ctl.open({ schemaVersion: 2, id: 'profile1', name: 'Practice', theme: null, audio: {} })
    const applying = ctl.confirm()
    await vi.runAllTimersAsync()
    await applying
    f.setJob({ state: 'finished', error: null, result: { status, batchId: null, items: [], errors: [], errorsEn: [] } })
    expect(await ctl.reconcile()).toBe(false)
    expect(ctl.getState()).toMatchObject({ phase: 'ready', canConfirm: true, error: { key: 'profile.apply.error.incomplete', params: { status } } })
    expect(plan).toHaveBeenCalledTimes(2)
    expect(f.execute).toHaveBeenCalledOnce()
  })

  it.each(['rolled-back', 'recovery-required'] as const)('Quick import shows its incomplete %s outcome without a clean notice', async status => {
    const f = fixture()
    const ctl = createImportController(f.bridge, null)
    await ctl.choose([PACK])
    await ctl.add()
    f.setJob({ state: 'finished', error: null, result: { status, batchId: null, items: [], errors: [], errorsEn: [] } })
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ phase: 'done', unresolved: false, outcome: null, message: null, error: { key: 'quick.error.incomplete', params: { status } } })
  })

  it('Profile keeps the dialog and failure reason, replans, and does not launch or repeat the write', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const launch = vi.spyOn(f.bridge, 'launchGame')
    const plan = vi.spyOn(f.bridge, 'planProfileApply').mockImplementation(input => f.bridge.planImport({ ...input, paths: [PACK], includeSettings: false }))
    const ctl = createApplyController(f.bridge, null)
    await ctl.open({ schemaVersion: 2, id: 'profile1', name: 'Practice', theme: null, audio: {} })
    const applying = ctl.confirm(true)
    await vi.runAllTimersAsync()
    expect(await applying).toBe('unresolved')
    expect(f.poll).toHaveBeenCalledTimes(3)
    expect(await ctl.reconcile()).toBe(false)
    expect(ctl.getState()).toMatchObject({ phase: 'ready', canConfirm: true, error: { zh: failure.message, en: failure.messageEn } })
    expect(plan).toHaveBeenCalledTimes(2)
    expect(f.execute).toHaveBeenCalledOnce()
    expect(launch).not.toHaveBeenCalled()
    f.poll.mockResolvedValue({ operationId: 'retry', planId: 'retry', state: 'finished', progress: null, error: null, result: { status: 'completed', batchId: null, items: [], errors: [], errorsEn: [] } })
    expect(await ctl.confirm()).toBe('completed')
    expect(f.execute.mock.calls[1]![0].planId).not.toBe(f.execute.mock.calls[0]![0].planId)
  })

  it('Quick import retains the failure and offers a fresh preview after its query fails', async () => {
    const f = fixture()
    const ctl = createImportController(f.bridge, null)
    await ctl.choose([PACK])
    const first = ctl.getState().preview!.planId
    await ctl.add()
    expect(ctl.getState().unresolved).toBe(true)
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ phase: 'ready', unresolved: false, outcome: null, message: null, error: { zh: failure.message, en: failure.messageEn } })
    expect(ctl.getState().preview!.planId).not.toBe(first)
    expect(f.execute).toHaveBeenCalledOnce()
  })

  it('a reconciliation request failure stays locked and can retry the same operation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const ctl = await sectionSetup(f)
    f.reconcile.mockRejectedValueOnce(new Error('IPC still unavailable'))
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ unresolved: true, message: null })
    await ctl.reconcile()
    expect(f.reconcile.mock.calls[1]).toEqual(f.reconcile.mock.calls[0])
    expect(ctl.getState().unresolved).toBe(false)
  })

  it.each(['finished', 'reconciled'] as const)('sections still unlock for a successful %s response', async state => {
    vi.useFakeTimers()
    const f = fixture()
    const ctl = await sectionSetup(f)
    f.setJob({ state, error: null, result: state === 'finished' ? { status: 'completed', batchId: null, items: [], errors: [], errorsEn: [] } : null })
    await ctl.reconcile()
    expect(ctl.getState()).toMatchObject({ unresolved: false, error: null, draft: null })
    expect(renderMsg('en', ctl.getState().message!)).toContain('Checked')
  })
})
