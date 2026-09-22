import { beforeEach, describe, expect, it } from 'vitest'
import { createSchemeController } from '../../../src/scheme/controller'
import type { SchemeTheme } from '../../../src/installer/contracts'
import { renderMsg } from '../../../src/i18n'

const blue: SchemeTheme = { name: 'Blue Room', file: 'Blue Room.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/Blue Room.json', readable: true, duplicateName: false }
const broken: SchemeTheme = { name: null, file: 'Broken.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/Broken.json', readable: false, duplicateName: false }
const twin: SchemeTheme = { name: 'Blue Room', file: 'Twin.json', path: 'D:/Game/FPSAimTrainer/Saved/SaveGames/Themes/Twin.json', readable: true, duplicateName: true }

type Job = { state: 'running' | 'finished' | 'failed' | 'unknown' | 'reconciled'; result?: { status: string }; error?: { code: string; message: string } }

function bridge(options: { candidates?: string[]; themes?: SchemeTheme[]; current?: string | null; job?: Job; reconcileJob?: Job } = {}) {
  const calls: string[] = []
  const jobs = options.job ? [options.job] : [{ state: 'finished', result: { status: 'completed' } } as Job]
  let jobIndex = 0
  const themes = options.themes ?? [blue, broken]
  return {
    calls,
    themeListCalls: () => calls.filter(call => call === 'schemeList').length,
    discover: async () => { calls.push('discover'); return { candidates: options.candidates ?? ['D:/Game'], defaultPack: null } },
    locate: async (root: string) => { calls.push(`locate:${root}`); return { gameRoot: root, backupRoot: 'D:/Backups', gameState: 'running' as const } },
    pickFolder: async () => { calls.push('pickFolder'); return 'D:/Picked' },
    schemeList: async (root: string) => {
      calls.push('schemeList')
      return { directory: `${root}/FPSAimTrainer/Saved/SaveGames/Themes`, current: options.current === undefined ? 'Old Theme' : options.current, themes }
    },
    planScheme: async (input: { gameRoot: string; file: string; revision: number }) => { calls.push(`planScheme:${input.file}`); return { planId: 'plan-1', kind: 'install' as const, rows: [], categories: ['primary' as const], revision: input.revision, location: { gameRoot: input.gameRoot, backupRoot: 'D:/Backups', gameState: 'running' as const }, packRoot: null, sourceId: null, skipped: [] } },
    execute: async (input: { operationId: string; planId: string }) => { calls.push(`execute:${input.planId}`); return { operationId: input.operationId, planId: input.planId, state: 'running' as const } },
    job: async () => { calls.push('job'); const job = jobs[Math.min(jobIndex++, jobs.length - 1)]!; return { operationId: 'op', planId: 'plan-1', ...job } },
    planFileAdd: async () => ({ planId: 'plan-add' }),
    pickFile: async () => null,
    reconcile: async () => { calls.push('reconcile'); return { job: { operationId: 'op', planId: 'plan-1', ...(options.reconcileJob ?? { state: 'reconciled' }) }, backups: null } },
  }
}

describe('scheme controller', () => {
  it('loads the installed themes from the discovered game folder and marks the current one', async () => {
    const b = bridge()
    const controller = createSchemeController(b)
    await controller.load()
    const state = controller.getState()
    expect(state.phase).toBe('ready')
    expect(state.gameRoot).toBe('D:/Game')
    expect(state.themes.map(theme => theme.file)).toEqual(['Blue Room.json', 'Broken.json'])
    expect(state.current).toBe('Old Theme')
    expect(state.error).toBeNull()
  })

  beforeEach(() => { try { window.localStorage.clear() } catch { /* nothing remembered either way */ } })

  it('asks for a folder when no game installation is found', async () => {
    const b = bridge({ candidates: [] })
    const controller = createSchemeController(b)
    await controller.load()
    expect(controller.getState().phase).toBe('needs-location')
    expect(controller.getState().gameRoot).toBeNull()
    await controller.chooseFolder('zh')
    expect(controller.getState().gameRoot).toBe('D:/Picked')
    expect(controller.getState().phase).toBe('ready')
  })

  // The friend's bug: with four sections each discovering on their own, a folder found by hand
  // on Theme meant nothing to Sounds, and the player had to find it again in every section.
  it('reuses the folder a section already found, without discovering again', async () => {
    const first = bridge({ candidates: [] })
    const firstController = createSchemeController(first)
    await firstController.load()
    await firstController.chooseFolder('zh')
    expect(firstController.getState().gameRoot).toBe('D:/Picked')

    // A second section, on the same machine, with auto-discovery still finding nothing.
    const second = bridge({ candidates: [] })
    const secondController = createSchemeController(second)
    await secondController.load()
    expect(secondController.getState().phase).toBe('ready')
    expect(secondController.getState().gameRoot).toBe('D:/Picked')
    expect(second.calls).not.toContain('discover')
  })

  it('asks again, rather than failing, when the remembered folder has gone', async () => {
    window.localStorage.setItem('aimloom.gameRoot', 'E:/Unplugged')
    const b = bridge({ candidates: [] })
    // The engine refuses a folder that is no longer a game install; the player must not see it.
    const gone = { ...b, locate: async (root: string) => { b.calls.push(`locate:${root}`); throw new Error('not a game folder') } }
    const controller = createSchemeController(gone)
    await controller.load()
    expect(controller.getState().phase).toBe('needs-location')
    expect(b.calls).toContain('discover')
    expect(window.localStorage.getItem('aimloom.gameRoot')).toBeNull()
  })

  it('opens only a readable theme whose name is unique', async () => {
    const b = bridge({ themes: [blue, broken, twin] })
    const controller = createSchemeController(b)
    await controller.load()
    controller.open(blue)
    expect(controller.getState().selected?.file).toBe('Blue Room.json')
    controller.close()
    expect(controller.getState().selected).toBeNull()
    controller.open(broken)
    expect(controller.getState().selected).toBeNull()
    expect(controller.getState().error).toEqual({ key: 'scheme.error.unreadable' })
    controller.open(twin)
    expect(controller.getState().selected).toBeNull()
    expect(controller.getState().error).toEqual({ key: 'scheme.error.duplicateName' })
  })

  it('applies the selected theme, moves the current marker and reports the persistent result', async () => {
    const b = bridge()
    const controller = createSchemeController(b)
    await controller.load()
    controller.open(blue)
    await controller.apply()
    const state = controller.getState()
    expect(state.selected).toBeNull()
    expect(state.applying).toBe(false)
    expect(state.current).toBe('Blue Room')
    expect(state.message).toEqual({ key: 'scheme.applied.success' })
    expect(state.error).toBeNull()
    expect(b.calls).toContain('planScheme:Blue Room.json')
    expect(b.themeListCalls()).toBe(2)
  })

  it('reports an already-current theme without claiming a change', async () => {
    const b = bridge({ job: { state: 'finished', result: { status: 'no-change' } } })
    const controller = createSchemeController(b)
    await controller.load()
    controller.open(blue)
    await controller.apply()
    expect(controller.getState().message).toEqual({ key: 'scheme.applied.noChange' })
    expect(controller.getState().error).toBeNull()
  })

  it('refreshes the list and stays open when the reviewed theme changed', async () => {
    const b = bridge({ job: { state: 'failed', error: { code: 'PLAN_STALE', message: '主题文件已改变' } } })
    const controller = createSchemeController(b)
    await controller.load()
    controller.open(blue)
    await controller.apply()
    const state = controller.getState()
    expect(state.selected?.file).toBe('Blue Room.json')
    expect(state.error ? renderMsg('zh', state.error) : null).toMatch(/改变/)
    expect(b.themeListCalls()).toBe(2)
  })

  it('locks the page until an unknown result is reconciled', async () => {
    const b = bridge({ job: { state: 'unknown' } })
    const controller = createSchemeController(b)
    await controller.load()
    controller.open(blue)
    await controller.apply()
    expect(controller.getState().unresolved).toBe(true)
    expect(controller.getState().message).toBeNull()
    // A locked page must not let another theme replace the one under review.
    controller.open(blue)
    expect(controller.getState().selected?.file).toBe('Blue Room.json')
    await controller.reconcile()
    expect(controller.getState().unresolved).toBe(false)
    expect(b.calls).toContain('reconcile')
  })
})
