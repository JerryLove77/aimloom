import { beforeEach, describe, expect, it } from 'vitest'
import { createAudioController } from '../../../src/audio/controller'
import { renderMsg } from '../../../src/i18n'
import type { AudioBindings, InstalledSound } from '../../../src/installer/contracts'

const sounds: InstalledSound[] = [
  { name: 'Bell5', file: 'Bell5.ogg', path: 'D:/Game/FPSAimTrainer/sounds/Bell5.ogg', ambiguous: false },
  { name: 'hit', file: 'hit.wav', path: 'D:/Game/FPSAimTrainer/sounds/hit.wav', ambiguous: false },
  { name: 'Twice', file: 'Twice.ogg', path: 'D:/Game/FPSAimTrainer/sounds/Twice.ogg', ambiguous: true },
]
const bindings: AudioBindings = { kill: ['Bell5'], spawn: [], mbsGood: ['None'], mbsOkay: [], mbsBad: [], mbsChangeNow: ['spawn05'] }

function bridge(options: { job?: { state: string; result?: { status: string }; error?: { code: string; message: string } } } = {}) {
  const calls: string[] = []
  const plans: { event: string; names: string[] }[] = []
  const job = options.job ?? { state: 'finished', result: { status: 'completed' } }
  const current: AudioBindings = structuredClone(bindings)
  return {
    calls, plans,
    discover: async () => { calls.push('discover'); return { candidates: ['D:/Game'] } },
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    audioList: async (root: string) => { calls.push('audioList'); return { directory: `${root}/sounds`, sounds, bindings: structuredClone(current) } },
    planAudio: async (input: { event: string; names: string[]; revision: number }) => {
      plans.push({ event: input.event, names: input.names })
      // A real apply writes the binding, so a refresh after it must show the new value.
      if (job.state === 'finished' && !job.error) (current as unknown as Record<string, string[]>)[input.event] = [...input.names]
      return { planId: 'plan-1' }
    },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => job,
    planFileAdd: async () => ({ planId: 'plan-add' }),
    pickFile: async () => null,
    reconcile: async () => { calls.push('reconcile'); return {} },
  }
}

describe('audio controller', () => {
  it('loads the installed sounds and the current binding of every event', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    const state = controller.getState()
    expect(state.phase).toBe('ready')
    expect(state.sounds.map(sound => sound.name)).toEqual(['Bell5', 'hit', 'Twice'])
    expect(state.bindings?.kill).toEqual(['Bell5'])
    expect(state.bindings?.mbsGood).toEqual(['None'])
  })

  it('reports an ambiguous name and refuses to bind it', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('kill')
    expect(controller.getState().event).toBe('kill')
    expect(controller.add('Twice')).toBe(false)
    expect(controller.getState().error).toEqual({ key: 'audio.error.ambiguous', params: { name: 'Twice' } })
    expect(controller.add('hit')).toBe(true)
    expect(controller.getState().draft).toEqual(['Bell5', 'hit'])
  })

  it('edits an ordered list with duplicates, reordering and clearing', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('kill')
    controller.add('hit'); controller.add('hit')
    expect(controller.getState().draft).toEqual(['Bell5', 'hit', 'hit'])
    controller.move(2, -1)
    expect(controller.getState().draft).toEqual(['Bell5', 'hit', 'hit'])
    controller.remove(0)
    expect(controller.getState().draft).toEqual(['hit', 'hit'])
    controller.clear()
    expect(controller.getState().draft).toEqual([])
  })

  it('replaces rather than appends for a single-value event', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('mbsGood')
    expect(controller.getState().draft).toEqual(['None'])
    expect(controller.add('hit')).toBe(true)
    expect(controller.getState().draft).toEqual(['hit'])
    // MBS events hold one value, so choosing another sound replaces the choice.
    expect(controller.add('Bell5')).toBe(true)
    expect(controller.getState().draft).toEqual(['Bell5'])
  })

  it('confirms one event and reports that the change is backed up', async () => {
    const b = bridge()
    const controller = createAudioController(b)
    await controller.load()
    controller.open('spawn')
    controller.add('Bell5')
    expect(await controller.apply()).toBe(true)
    expect(b.plans).toEqual([{ event: 'spawn', names: ['Bell5'] }])
    const state = controller.getState()
    // The editor stays on the applied event; only its draft clears, so the page can show
    // the new binding without the user re-selecting the event.
    expect(state.event).toBe('spawn')
    expect(state.drafts.spawn).toBeUndefined()
    expect(state.draft).toEqual(['Bell5'])
    expect(state.message && renderMsg('zh', state.message)).toMatch(/下次启动/)
    expect(state.bindings?.spawn).toEqual(['Bell5'])
  })

  it('keeps the draft and reports the reason when the write is refused', async () => {
    const controller = createAudioController(bridge({ job: { state: 'failed', error: { code: 'PLAN_STALE', message: '设置文件已改变' } } }))
    await controller.load()
    controller.open('kill')
    controller.add('hit')
    expect(await controller.apply()).toBe(false)
    expect(controller.getState().event).toBe('kill')
    expect(controller.getState().draft).toEqual(['Bell5', 'hit'])
    const error = controller.getState().error
    expect(error && renderMsg('zh', error)).toMatch(/改变/)
  })

  it('locks the page until an unknown result is reconciled', async () => {
    const b = bridge({ job: { state: 'unknown' } })
    const controller = createAudioController(b)
    await controller.load()
    controller.open('kill')
    await controller.apply()
    expect(controller.getState().unresolved).toBe(true)
    expect(controller.add('hit')).toBe(false)
    await controller.reconcile()
    expect(controller.getState().unresolved).toBe(false)
    expect(b.calls).toContain('reconcile')
  })
})

describe('audio per-event drafts', () => {
  it('keeps a separate draft per event across switching', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('kill'); controller.add('hit')
    controller.open('mbsGood'); controller.add('Bell5')
    controller.open('kill')
    expect(controller.getState().draft).toEqual(['Bell5', 'hit'])
    expect([...controller.pendingEvents()].sort()).toEqual(['kill', 'mbsGood'])
  })

  it('treats an edit back to the binding as no change', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('kill'); controller.add('hit'); controller.remove(1)
    expect(controller.getState().drafts.kill).toBeUndefined()
    expect(controller.pendingEvents()).toEqual([])
  })

  it('discard drops only the selected event draft', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('spawn'); controller.add('hit')
    controller.open('kill'); controller.add('hit')
    controller.discard()
    expect(controller.getState().draft).toEqual(['Bell5'])
    expect(controller.pendingEvents()).toEqual(['spawn'])
  })

  it('applying one event keeps the other drafts and the selection', async () => {
    const b = bridge()
    const controller = createAudioController(b)
    await controller.load()
    controller.open('spawn'); controller.add('hit')
    controller.open('kill'); controller.add('hit')
    expect(await controller.apply()).toBe(true)
    expect(b.plans).toEqual([{ event: 'kill', names: ['Bell5', 'hit'] }])
    expect(controller.getState().event).toBe('kill')
    expect(controller.getState().draft).toEqual(['Bell5', 'hit'])
    expect(controller.pendingEvents()).toEqual(['spawn'])
  })

  it('replaces a list event with one sound in a single step', async () => {
    const controller = createAudioController(bridge())
    await controller.load()
    controller.open('kill')
    controller.add('hit')
    expect(controller.getState().draft).toEqual(['Bell5', 'hit'])
    expect(controller.only('hit')).toBe(true)
    expect(controller.getState().draft).toEqual(['hit'])
    expect(controller.getState().drafts.kill).toEqual(['hit'])
    // Choosing the sound that is already the whole binding is not a change.
    expect(controller.only('Bell5')).toBe(true)
    expect(controller.getState().drafts.kill).toBeUndefined()
    // The same refusals as adding.
    expect(controller.only('Twice')).toBe(false)
    expect(controller.getState().error).toEqual({ key: 'audio.error.ambiguous', params: { name: 'Twice' } })
    expect(controller.only('missing')).toBe(false)
  })
})


// The friend's bug: four sections each discovered the game on their own and told each other
// nothing, so a folder found by hand in one section meant nothing in the next. These prove this
// section reads the shared folder -- the scheme suite proves the same for Theme.
describe('audio and the remembered game folder', () => {
  beforeEach(() => { try { window.localStorage.clear() } catch { /* nothing remembered either way */ } })

  function counting(inner: ReturnType<typeof bridge>) {
    let discovers = 0
    return { wrapped: { ...inner, discover: async () => { discovers++; return inner.discover() } }, discovers: () => discovers }
  }

  it('loads the remembered folder without discovering again', async () => {
    window.localStorage.setItem('aimloom.gameRoot', 'D:/Game')
    const { wrapped: counted, discovers } = counting(bridge())
    const controller = createAudioController(counted)
    await controller.load()
    expect(controller.getState().gameRoot).toBe('D:/Game')
    expect(discovers()).toBe(0)
  })

  it('remembers what it discovered, for the sections after it', async () => {
    const { wrapped: counted } = counting(bridge())
    const controller = createAudioController(counted)
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
    const controller = createAudioController(counted)
    await controller.load()
    expect(discovers()).toBe(1)
    expect(controller.getState().gameRoot).toBe('D:/Game')
    expect(window.localStorage.getItem('aimloom.gameRoot')).toBe('D:/Game')
  })
})
