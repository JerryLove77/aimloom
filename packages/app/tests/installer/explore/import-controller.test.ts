import { describe, expect, it, vi } from 'vitest'
import { createDemoBridge } from '../../../src/bridge/demo'
import { InstallerFailure, type Preview } from '../../../src/bridge/contracts'
import { createImportController } from '../../../src/explore/import-controller'

const PACK = 'C:\\Users\\Player1\\Downloads\\Pack'
const refusal = (code: 'GAME_RUNNING' | 'RECOVERY_REQUIRED' | 'ENGINE_ERROR') => new InstallerFailure({ code, message: '拒绝', messageEn: 'Refused', path: null })

function setup() {
  const bridge = createDemoBridge({ durationMs: 0 })
  return { bridge, ctl: createImportController(bridge, null) }
}

describe('Quick import controller', () => {
  it('finds the game, plans what was chosen and adds it once, with settings only on request', async () => {
    const { bridge, ctl } = setup()
    const plan = vi.spyOn(bridge, 'planImport')
    const execute = vi.spyOn(bridge, 'execute')
    await ctl.choose([PACK])
    expect(ctl.getState().phase).toBe('ready')
    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ paths: [PACK], includeSettings: false }))
    expect(execute).not.toHaveBeenCalled()
    await ctl.setIncludeSettings(true)
    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ includeSettings: true }))
    expect(ctl.getState().preview?.rows.some(r => r.action === 'replace' && r.category === 'primary')).toBe(true)
    await Promise.all([ctl.add(), ctl.add()])
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ confirmation: 'install', allowConflicts: false, planId: ctl.getState().preview?.planId }))
    expect(ctl.getState().phase).toBe('done')
    expect(ctl.getState().outcome?.status).toBe('completed')
  })

  it('an older plan never overwrites a newer choice', async () => {
    const { bridge, ctl } = setup()
    const original = bridge.planImport.bind(bridge)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    bridge.planImport = async input => { if (input.paths[0] === 'C:\\old') await held; return original(input) }
    const first = ctl.choose(['C:\\old'])
    await ctl.choose([PACK])
    release(); await first
    expect(ctl.getState().paths).toEqual([PACK])
    expect(ctl.getState().preview?.rows.some(r => r.source?.startsWith('C:\\old'))).toBe(false)
  })

  it('explains a running game and an unfinished batch with their own notices, and checks again', async () => {
    const { bridge, ctl } = setup()
    const original = bridge.planImport.bind(bridge)
    bridge.planImport = async () => { throw refusal('GAME_RUNNING') }
    await ctl.choose([PACK])
    expect(ctl.getState()).toMatchObject({ phase: 'blocked', blocked: 'game-running' })
    bridge.planImport = async () => { throw refusal('RECOVERY_REQUIRED') }
    await ctl.recheck()
    expect(ctl.getState()).toMatchObject({ phase: 'blocked', blocked: 'recovery' })
    bridge.planImport = original
    await ctl.recheck()
    expect(ctl.getState()).toMatchObject({ phase: 'ready', blocked: null })
  })

  it('sends nothing when the plan adds nothing', async () => {
    const { bridge, ctl } = setup()
    const execute = vi.spyOn(bridge, 'execute')
    const original = bridge.planImport.bind(bridge)
    bridge.planImport = async input => { const p: Preview = await original(input); return { ...p, rows: p.rows.map(r => ({ ...r, action: 'skip' as const, reason: 'exists-same' as const })) } }
    await ctl.choose([PACK])
    await ctl.add()
    expect(execute).not.toHaveBeenCalled()
    expect(ctl.getState().phase).toBe('ready')
  })

  it('an unknown outcome locks the page until it is reconciled; never success', async () => {
    const { bridge, ctl } = setup()
    bridge.job = async operationId => ({ operationId, planId: 'p', state: 'unknown', progress: null, result: null, error: null })
    const reconcile = vi.spyOn(bridge, 'reconcile').mockResolvedValue({ job: { operationId: 'x', planId: 'p', state: 'reconciled', progress: null, result: null, error: null }, backups: null } as never)
    await ctl.choose([PACK])
    await ctl.add()
    expect(ctl.getState()).toMatchObject({ phase: 'done', unresolved: true, outcome: null })
    const plan = vi.spyOn(bridge, 'planImport')
    await ctl.choose(['C:\\other'])
    ctl.reset()
    await ctl.setIncludeSettings(true)
    expect(plan).not.toHaveBeenCalled()
    expect(ctl.getState().phase).toBe('done')
    await ctl.reconcile()
    expect(reconcile).toHaveBeenCalledOnce()
    expect(ctl.getState().unresolved).toBe(false)
    ctl.reset()
    expect(ctl.getState().phase).toBe('idle')
  })

  it('a refused execute is a refusal before anything ran, not an unknown write', async () => {
    const { bridge, ctl } = setup()
    bridge.execute = async () => { throw new InstallerFailure({ code: 'PLAN_STALE', message: '预览已改变', messageEn: 'The preview changed', path: null }) }
    await ctl.choose([PACK])
    await ctl.add()
    expect(ctl.getState()).toMatchObject({ phase: 'ready', unresolved: false })
    expect(ctl.getState().error).not.toBeNull()
  })

  it('asks for the game folder when discovery finds none, then plans', async () => {
    const { bridge, ctl } = setup()
    bridge.discover = async () => ({ candidates: [], defaultPack: null })
    await ctl.choose([PACK])
    expect(ctl.getState().phase).toBe('needs-location')
    await ctl.chooseGameRoot('D:\\Games\\FPSAimTrainer')
    expect(ctl.getState()).toMatchObject({ phase: 'ready', gameRoot: 'D:\\Games\\FPSAimTrainer' })
  })

  it('a picker that is cancelled changes nothing', async () => {
    const { bridge, ctl } = setup()
    bridge.pickFiles = async () => null
    await ctl.pick('files', 'zh')
    expect(ctl.getState().phase).toBe('idle')
  })
})
