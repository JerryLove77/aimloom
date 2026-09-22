import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePng } from '../../../../crosshair/src/png'
import { createCrosshairController } from '../../../src/crosshair/controller'
import type { InstalledCrosshair } from '../../../src/installer/contracts'
import { renderMsg } from '../../../src/i18n'

const slots: InstalledCrosshair[] = [
  { name: 'aimloom_slot', file: 'aimloom_slot.png', path: 'D:/Game/FPSAimTrainer/crosshairs/aimloom_slot.png' },
  { name: 'dot', file: 'dot.png', path: 'D:/Game/FPSAimTrainer/crosshairs/dot.png' },
]
const pixels = (value: number) => Uint8Array.from({ length: 3 * 2 * 4 }, (_, index) => (index % 4 === 3 ? 255 : value + index))
const canonical = encodePng({ width: 3, height: 2, data: pixels(4), warnings: [] })
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const wire = () => base64(canonical)

function bridge(options: { job?: { state: string; result?: { status: string }; error?: { code: string; message: string } } } = {}) {
  const calls: string[] = []
  const plans: { file: string; pngBase64: string }[] = []
  const job = options.job ?? { state: 'finished', result: { status: 'completed' } }
  return {
    calls, plans,
    discover: async () => { calls.push('discover'); return { candidates: ['D:/Game'] } },
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    crosshairList: async (root: string) => { calls.push('crosshairList'); return { directory: `${root}/crosshairs`, crosshairs: slots } },
    planCrosshair: async (input: { file: string; pngBase64: string; revision: number }) => { plans.push({ file: input.file, pngBase64: input.pngBase64 }); return { planId: 'plan-1' } },
    planCrosshairAdd: async (input: { file: string; pngBase64: string; revision: number }) => { plans.push({ file: input.file, pngBase64: input.pngBase64 }); return { planId: 'plan-1' } },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => job,
    reconcile: async () => { calls.push('reconcile'); return {} },
    pickFile: async () => null,
  }
}

describe('crosshair controller', () => {
  it('lists the installed slots', async () => {
    const controller = createCrosshairController(bridge(), async () => canonical)
    await controller.load()
    expect(controller.getState().phase).toBe('ready')
    expect(controller.getState().slots.map(slot => slot.file)).toEqual(['aimloom_slot.png', 'dot.png'])
  })

  it('prepares the chosen image and applies it to the chosen slot', async () => {
    const b = bridge()
    const controller = createCrosshairController(b, async () => canonical)
    await controller.load()
    controller.open(slots[0]!)
    expect(controller.getState().slot?.file).toBe('aimloom_slot.png')
    await controller.chooseSource('D:/Pictures/my-crosshair.png')
    expect(controller.getState().source?.name).toBe('my-crosshair.png')
    expect(controller.getState().ready).toBe(true)
    expect(await controller.apply()).toBe(true)
    expect(b.plans).toEqual([{ file: 'aimloom_slot.png', pngBase64: wire() }])
    const state = controller.getState()
    expect(state.slot).toBeNull()
    expect(state.message).toEqual({ key: 'crosshair.applied.replaced', params: { file: 'aimloom_slot.png' } })
  })

  it('reports why a chosen image cannot be used instead of accepting it', async () => {
    const controller = createCrosshairController(bridge(), async () => new Uint8Array([1, 2, 3]))
    await controller.load()
    controller.open(slots[1]!)
    await controller.chooseSource('D:/Pictures/broken.png')
    expect(controller.getState().source).toBeNull()
    expect(controller.getState().ready).toBe(false)
    const error = controller.getState().error
    expect(error ? renderMsg('zh', error) : null).toMatch(/无法读取|MiB|尺寸|签名/)
    expect(controller.getState().slot?.file).toBe('dot.png')
  })

  it('refuses to apply without both a slot and a prepared image', async () => {
    const b = bridge()
    const controller = createCrosshairController(b, async () => canonical)
    await controller.load()
    expect(await controller.apply()).toBe(false)
    controller.open(slots[0]!)
    expect(await controller.apply()).toBe(false)
    expect(b.plans).toEqual([])
    const error = controller.getState().error
    expect(error ? renderMsg('zh', error) : null).toMatch(/选择|图片/)
  })

  it('keeps the selection and the reason when the write is refused', async () => {
    const controller = createCrosshairController(bridge({ job: { state: 'failed', error: { code: 'PLAN_STALE', message: '目标文件已改变' } } }), async () => canonical)
    await controller.load()
    controller.open(slots[0]!)
    await controller.chooseSource('D:/Pictures/my-crosshair.png')
    expect(await controller.apply()).toBe(false)
    expect(controller.getState().slot?.file).toBe('aimloom_slot.png')
    expect(controller.getState().ready).toBe(true)
    const error = controller.getState().error
    expect(error ? renderMsg('zh', error) : null).toMatch(/改变/)
  })

  it('adds a new crosshair under a name the user types', async () => {
    const b = bridge()
    const controller = createCrosshairController(b, async () => canonical)
    await controller.load()
    controller.startAdd()
    expect(controller.getState().mode).toBe('add')
    controller.setNewName('my-crosshair')
    await controller.chooseSource('D:/Pictures/my-crosshair.png')
    expect(await controller.apply()).toBe(true)
    // The extension is added for the user; the wire always carries a file name.
    expect(b.plans).toEqual([{ file: 'my-crosshair.png', pngBase64: wire() }])
    expect(controller.getState().message).toEqual({ key: 'crosshair.applied.added', params: { file: 'my-crosshair.png' } })
  })

  it('refuses to add over an existing crosshair or with an unsafe name', async () => {
    const b = bridge()
    const controller = createCrosshairController(b, async () => canonical)
    await controller.load()
    controller.startAdd()
    controller.setNewName('dot')
    await controller.chooseSource('D:/Pictures/my-crosshair.png')
    expect(controller.getState().nameError).toEqual({ key: 'crosshair.name.taken' })
    expect(await controller.apply()).toBe(false)
    for (const bad of ['', '   ', '../escape', 'a/b', 'con', 'trailing.']) {
      controller.setNewName(bad)
      expect(controller.getState().nameError, `expected ${JSON.stringify(bad)} to be refused`).toBeTruthy()
    }
    expect(b.plans).toEqual([])
  })

  it('starts a replacement from a clean add state and the other way round', async () => {
    const controller = createCrosshairController(bridge(), async () => canonical)
    await controller.load()
    controller.startAdd()
    controller.setNewName('mine')
    controller.open(slots[0]!)
    expect(controller.getState().mode).toBe('replace')
    expect(controller.getState().newName).toBe('')
    controller.startAdd()
    expect(controller.getState().slot).toBeNull()
    expect(controller.getState().source).toBeNull()
  })

  it('locks the page until an unknown result is reconciled', async () => {
    const b = bridge({ job: { state: 'unknown' } })
    const controller = createCrosshairController(b, async () => canonical)
    await controller.load()
    controller.open(slots[0]!)
    await controller.chooseSource('D:/Pictures/my-crosshair.png')
    await controller.apply()
    expect(controller.getState().unresolved).toBe(true)
    expect(controller.open(slots[1]!)).toBeUndefined()
    expect(controller.getState().slot?.file).toBe('aimloom_slot.png')
    await controller.reconcile()
    expect(controller.getState().unresolved).toBe(false)
    expect(b.calls).toContain('reconcile')
    // The page's sheets follow this state: after reconciling, nothing is chosen, so none reopens.
    expect(controller.getState()).toMatchObject({ mode: 'replace', slot: null, source: null, ready: false })
  })

  it('reads the source once per choice and drops a superseded read', async () => {
    const read = vi.fn(async () => canonical)
    const controller = createCrosshairController(bridge(), read)
    await controller.load()
    controller.open(slots[0]!)
    await Promise.all([controller.chooseSource('D:/a.png'), controller.chooseSource('D:/b.png')])
    expect(read).toHaveBeenCalledTimes(2)
    expect(controller.getState().source?.name).toBe('b.png')
  })

  it('adds a generated image through the add path without reading a file', async () => {
    const b = bridge()
    const readSource = vi.fn(async () => canonical)
    const controller = createCrosshairController(b, readSource)
    await controller.load()
    controller.startAdd()
    controller.setNewName('from-code')
    expect(await controller.addGenerated({ label: 'CS2 准星代码', pngBase64: wire(), width: 3, height: 2 })).toBe(true)
    expect(readSource).not.toHaveBeenCalled()
    expect(b.plans).toEqual([{ file: 'from-code.png', pngBase64: wire() }])
    expect(controller.getState().message).toEqual({ key: 'crosshair.applied.added', params: { file: 'from-code.png' } })
    // Adding a file selects nothing: the player is told to pick it in the game.
    const message = controller.getState().message
    expect(message ? renderMsg('zh', message) : null).toMatch(/到游戏.*选中它/)
    expect(controller.getState().mode).toBe('replace')
  })

  it('refuses a generated image outside add mode or under a taken name', async () => {
    const b = bridge()
    const controller = createCrosshairController(b, async () => canonical)
    await controller.load()
    const image = { label: '准星代码', pngBase64: wire(), width: 3, height: 2 }
    // Not in add mode: there is no name to add it under.
    expect(await controller.addGenerated(image)).toBe(false)
    controller.startAdd()
    controller.setNewName('dot')
    expect(await controller.addGenerated(image)).toBe(false)
    expect(controller.getState().nameError).toEqual({ key: 'crosshair.name.taken' })
    expect(b.plans).toEqual([])
  })

  it('counts .png toward the 128-character limit, as the engine does', async () => {
    const controller = createCrosshairController(bridge(), async () => canonical)
    await controller.load()
    controller.startAdd()
    controller.setNewName('a'.repeat(124))
    expect(controller.getState().nameError).toBeNull()
    controller.setNewName('a'.repeat(125))
    expect(controller.getState().nameError).toEqual({ key: 'crosshair.name.tooLong' })
    // A name that already carries the extension is measured the same way.
    controller.setNewName(`${'a'.repeat(124)}.png`)
    expect(controller.getState().nameError).toBeNull()
  })

  it('add-mode failures say 新增, never 替换', async () => {
    const failed = bridge({ job: { state: 'failed', error: { code: 'ENGINE_ERROR', message: 'Case collision at target: x' } } })
    const controller = createCrosshairController(failed, async () => canonical)
    await controller.load()
    controller.startAdd()
    controller.setNewName('mine')
    expect(await controller.addGenerated({ label: '准星代码', pngBase64: wire(), width: 3, height: 2 })).toBe(false)
    const error = controller.getState().error
    const zh = error ? renderMsg('zh', error) : null
    expect(zh).toMatch(/新增失败/)
    expect(zh).not.toMatch(/替换/)
    // The raw English travels as detail, never alone.
    expect(zh).toMatch(/详细信息：Case collision/)
  })

  it('shows Chinese for a coded English refusal, at plan time and at job time', async () => {
    const stale = { ...bridge(), planCrosshairAdd: async () => { throw Object.assign(new Error('Install source or target changed after preview.'), { issue: { code: 'PLAN_STALE', message: 'Install source or target changed after preview.', path: null } }) } }
    const atPlan = createCrosshairController(stale, async () => canonical)
    await atPlan.load()
    atPlan.startAdd()
    atPlan.setNewName('mine')
    expect(await atPlan.addGenerated({ label: '准星代码', pngBase64: wire(), width: 3, height: 2 })).toBe(false)
    const atPlanError = atPlan.getState().error
    expect(atPlanError ? renderMsg('zh', atPlanError) : null).toMatch(/预览之后发生了改变/)

    const atJob = createCrosshairController(bridge({ job: { state: 'failed', error: { code: 'RECOVERY_REQUIRED', message: 'An unfinished operation must be recovered before adding a crosshair.' } } }), async () => canonical)
    await atJob.load()
    atJob.startAdd()
    atJob.setNewName('mine')
    expect(await atJob.addGenerated({ label: '准星代码', pngBase64: wire(), width: 3, height: 2 })).toBe(false)
    const atJobError = atJob.getState().error
    expect(atJobError ? renderMsg('zh', atJobError) : null).toMatch(/一键拖入/)
  })
})


// The friend's bug: four sections each discovered the game on their own and told each other
// nothing, so a folder found by hand in one section meant nothing in the next. These prove this
// section reads the shared folder -- the scheme suite proves the same for Theme.
describe('crosshair and the remembered game folder', () => {
  beforeEach(() => { try { window.localStorage.clear() } catch { /* nothing remembered either way */ } })

  function counting(inner: ReturnType<typeof bridge>) {
    let discovers = 0
    return { wrapped: { ...inner, discover: async () => { discovers++; return inner.discover() } }, discovers: () => discovers }
  }

  it('loads the remembered folder without discovering again', async () => {
    window.localStorage.setItem('aimloom.gameRoot', 'D:/Game')
    const { wrapped: counted, discovers } = counting(bridge())
    const controller = createCrosshairController(counted, async () => new Uint8Array([1, 2, 3]))
    await controller.load()
    expect(controller.getState().gameRoot).toBe('D:/Game')
    expect(discovers()).toBe(0)
  })

  it('remembers what it discovered, for the sections after it', async () => {
    const { wrapped: counted } = counting(bridge())
    const controller = createCrosshairController(counted, async () => new Uint8Array([1, 2, 3]))
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
    const controller = createCrosshairController(counted, async () => new Uint8Array([1, 2, 3]))
    await controller.load()
    expect(discovers()).toBe(1)
    expect(controller.getState().gameRoot).toBe('D:/Game')
    expect(window.localStorage.getItem('aimloom.gameRoot')).toBe('D:/Game')
  })
})
