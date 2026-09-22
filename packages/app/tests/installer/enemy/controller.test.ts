import { beforeEach, describe, expect, it } from 'vitest'
import { createEnemyController } from '../../../src/enemy/controller'
import type { EnemyList, EnemyShape } from '../../../src/installer/contracts'
import { renderMsg } from '../../../src/i18n'

const skins: EnemyList['skins'] = [
  { label: 'None', model: 'None', skin: 'None', shapes: ['cylindrical', 'cuboid', 'spheroid'] },
  { label: 'Ghost', model: 'Ghost', skin: 'Default', shapes: ['cylindrical', 'cuboid', 'spheroid'] },
  { label: 'Mummy', model: 'Mummy', skin: 'Default', shapes: ['cylindrical', 'cuboid', 'spheroid'] },
  { label: 'Stylized', model: 'Stylized Ecto', skin: 'Default', shapes: ['cylindrical'] },
]

type Job = { state: string; result?: { status: string }; error?: { code: string; message: string } }
function bridge(options: { job?: Job } = {}) {
  const calls: string[] = []
  const plans: Array<{ shape: EnemyShape; model: string; skin: string }> = []
  const job = options.job ?? { state: 'finished', result: { status: 'completed' } }
  let current: EnemyList['current'] = { cylindrical: { model: 'Stylized Ecto', skin: 'Default' }, cuboid: { model: 'Ghost', skin: 'Default' }, spheroid: null }
  return {
    calls, plans,
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    enemyList: async () => { calls.push('enemyList'); return { current: structuredClone(current), skins: structuredClone(skins) } },
    planEnemy: async (input: { shape: EnemyShape; model: string; skin: string; revision: number }) => {
      plans.push({ shape: input.shape, model: input.model, skin: input.skin })
      if (job.state === 'finished') current = { ...current, [input.shape]: { model: input.model, skin: input.skin } }
      return { planId: 'plan-1' }
    },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => job,
    reconcile: async () => { calls.push('reconcile'); return {} },
  }
}

describe('enemy controller', () => {
  it('lists the fixed catalog and the current pair per shape', async () => {
    const controller = createEnemyController(bridge())
    await controller.load()
    expect(controller.getState().phase).toBe('ready')
    expect(controller.getState().skins).toHaveLength(4)
    expect(controller.getState().current.cylindrical).toEqual({ model: 'Stylized Ecto', skin: 'Default' })
    expect(controller.getState().current.spheroid).toBeNull()
  })

  it('picking a skin makes it pending for the active shape', async () => {
    const controller = createEnemyController(bridge())
    await controller.load()
    controller.open(skins[1]!) // Ghost, shape defaults to cylindrical
    expect(controller.getState().selected.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
  })

  it('switching the shape tab keeps every shape\'s pending pick (decision B)', async () => {
    const controller = createEnemyController(bridge())
    await controller.load()
    controller.open(skins[1]!) // Ghost, pending for cylindrical
    controller.selectShape('cuboid')
    expect(controller.getState().shape).toBe('cuboid')
    expect(controller.getState().selected.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
    expect(controller.getState().selected.cuboid).toBeUndefined()
    controller.open(skins[2]!) // Mummy, pending for cuboid
    expect(controller.getState().selected.cuboid).toEqual({ model: 'Mummy', skin: 'Default' })
    controller.selectShape('cylindrical')
    expect(controller.getState().selected.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
    expect(controller.getState().selected.cuboid).toEqual({ model: 'Mummy', skin: 'Default' })
    expect(controller.pendingShapes()).toEqual(['cylindrical', 'cuboid'])
  })

  it('opening the currently equipped skin does not create a pending pick, and Apply is a no-op', async () => {
    const controller = createEnemyController(bridge())
    await controller.load()
    controller.open(skins[3]!) // Stylized Ecto/Default, already equipped for cylindrical
    expect(controller.getState().selected.cylindrical).toBeUndefined()
    expect(await controller.apply()).toBe(false)
  })

  it('退出 discards only the active shape\'s pending pick', async () => {
    const controller = createEnemyController(bridge())
    await controller.load()
    controller.open(skins[1]!) // Ghost, pending for cylindrical
    controller.selectShape('cuboid')
    controller.open(skins[2]!) // Mummy, pending for cuboid
    controller.close()
    expect(controller.getState().selected.cuboid).toBeUndefined()
    expect(controller.getState().selected.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
  })

  it('applies the chosen skin for the active shape and refreshes the current pair', async () => {
    const b = bridge()
    const controller = createEnemyController(b)
    await controller.load()
    controller.open(skins[1]!) // Ghost
    expect(await controller.apply()).toBe(true)
    expect(b.plans).toEqual([{ shape: 'cylindrical', model: 'Ghost', skin: 'Default' }])
    const state = controller.getState()
    expect(state.selected.cylindrical).toBeUndefined()
    expect(state.current.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
    expect(state.message).toEqual({ key: 'enemy.applied.success' })
  })

  it('keeps the selection and the reason when the write is refused', async () => {
    const controller = createEnemyController(bridge({ job: { state: 'failed', error: { code: 'PLAN_STALE', message: '设置文件已改变' } } }))
    await controller.load()
    controller.open(skins[1]!)
    expect(await controller.apply()).toBe(false)
    expect(controller.getState().selected.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
    const error = controller.getState().error
    expect(error ? renderMsg('zh', error) : '').toMatch(/改变/)
  })

  it('reports an identical pair as no change', async () => {
    const controller = createEnemyController(bridge({ job: { state: 'finished', result: { status: 'no-change' } } }))
    await controller.load()
    controller.open(skins[1]!)
    expect(await controller.apply()).toBe(true)
    expect(controller.getState().message).toEqual({ key: 'enemy.applied.noChange' })
  })

  it('locks the page until an unknown result is reconciled', async () => {
    const b = bridge({ job: { state: 'unknown' } })
    const controller = createEnemyController(b)
    await controller.load()
    controller.open(skins[1]!)
    await controller.apply()
    expect(controller.getState().unresolved).toBe(true)
    controller.open(skins[2]!)
    expect(controller.getState().selected.cylindrical).toEqual({ model: 'Ghost', skin: 'Default' })
    await controller.reconcile()
    expect(controller.getState().unresolved).toBe(false)
    expect(b.calls).toContain('reconcile')
  })
})

// The friend's bug: four sections each discovered the game on their own and told each other
// nothing, so a folder found by hand in one section meant nothing in the next. These prove this
// section reads the shared folder -- the scheme suite proves the same for Theme.
describe('enemy and the remembered game folder', () => {
  beforeEach(() => { try { window.localStorage.clear() } catch { /* nothing remembered either way */ } })

  function counting(inner: ReturnType<typeof bridge>) {
    let discovers = 0
    return { wrapped: { ...inner, discover: async () => { discovers++; return inner.discover() } }, discovers: () => discovers }
  }

  it('loads the remembered folder without discovering again', async () => {
    window.localStorage.setItem('aimloom.gameRoot', 'D:/Game')
    const { wrapped: counted, discovers } = counting(bridge())
    const controller = createEnemyController(counted)
    await controller.load()
    expect(controller.getState().gameRoot).toBe('D:/Game')
    expect(discovers()).toBe(0)
  })

  it('remembers what it discovered, for the sections after it', async () => {
    const { wrapped: counted } = counting(bridge())
    const controller = createEnemyController(counted)
    await controller.load()
    expect(window.localStorage.getItem('aimloom.gameRoot')).toBe('D:/Game')
  })

  it('discovers again, rather than failing, when the remembered folder has gone', async () => {
    window.localStorage.setItem('aimloom.gameRoot', 'E:/Unplugged')
    const { wrapped, discovers } = counting(bridge())
    // The engine refuses a folder that is no longer a game install.
    const counted = { ...wrapped, locate: async (root: string) => {
      if (root === 'E:/Unplugged') throw new Error('not a game folder')
      return { gameRoot: root }
    } }
    const controller = createEnemyController(counted)
    await controller.load()
    expect(discovers()).toBe(1)
    expect(controller.getState().gameRoot).toBe('D:/Game')
    expect(window.localStorage.getItem('aimloom.gameRoot')).toBe('D:/Game')
  })
})
