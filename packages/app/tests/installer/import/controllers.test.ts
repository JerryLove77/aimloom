import { describe, expect, it } from 'vitest'
import { createSchemeController } from '../../../src/scheme/controller'
import { createAudioController } from '../../../src/audio/controller'
import type { AudioBindings, InstalledSound, PlanFileAddRequest, SchemeTheme } from '../../../src/installer/contracts'
import { renderMsg } from '../../../src/i18n'

type Job = { state: string; result?: { status: string }; error?: { code: string; message: string } }
const themeInput = { sourcePath: 'C:/Users/me/Downloads/Night.json', sourceSha256: 'a'.repeat(64), file: 'Night.json' }
const soundInput = { sourcePath: 'C:/Users/me/Downloads/Soft.wav', sourceSha256: 'b'.repeat(64), file: 'Soft.wav' }

/** The calls every section bridge shares. A completed add makes the file show up in the next listing. */
function shared(options: { job?: Job; planError?: unknown; hold?: Promise<void> } = {}) {
  const calls: string[] = []
  const adds: PlanFileAddRequest[] = []
  const added: string[] = []
  const job = options.job ?? { state: 'finished', result: { status: 'completed' } }
  return {
    calls, adds, added,
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    pickFile: async (kind: 'theme' | 'sound') => { calls.push(`pickFile:${kind}`); return 'C:/Users/me/Downloads/picked' },
    planFileAdd: async (input: PlanFileAddRequest) => {
      adds.push(input)
      if (options.hold) await options.hold
      if (options.planError) throw options.planError
      if (job.state === 'finished' && job.result?.status === 'completed') added.push(input.file)
      return { planId: 'plan-add' }
    },
    execute: async (input: { operationId: string; planId: string; confirmation: string; allowConflicts: boolean }) => {
      calls.push(`execute:${input.planId}:${input.confirmation}:${input.allowConflicts}`)
      return { operationId: input.operationId }
    },
    job: async () => job,
    reconcile: async () => { calls.push('reconcile'); return {} },
  }
}

const schemeTheme = (file: string): SchemeTheme => ({ name: file.replace(/\.json$/, ''), file, path: `D:/Game/Themes/${file}`, readable: true, duplicateName: false })
function schemeBridge(options: Parameters<typeof shared>[0] = {}) {
  const base = shared(options)
  return {
    ...base,
    schemeList: async (root: string) => { base.calls.push('schemeList'); return { directory: `${root}/Themes`, current: 'Old Theme', themes: [schemeTheme('Blue.json'), ...base.added.map(schemeTheme)] } },
    planScheme: async () => { base.calls.push('planScheme'); return { planId: 'plan-apply' } },
  }
}

const bindings: AudioBindings = { kill: ['Bell5'], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] }
const sound = (file: string): InstalledSound => ({ name: file.replace(/\.(wav|ogg)$/, ''), file, path: `D:/Game/sounds/${file}`, ambiguous: false })
function audioBridge(options: Parameters<typeof shared>[0] = {}) {
  const base = shared(options)
  return {
    ...base,
    audioList: async (root: string) => ({ directory: `${root}/sounds`, sounds: [sound('Bell5.ogg'), sound('hit.wav'), ...base.added.map(sound)], bindings: structuredClone(bindings) }),
    planAudio: async () => { base.calls.push('planAudio'); return { planId: 'plan-apply' } },
  }
}

describe('Scheme: adding a theme from outside the game', () => {
  it('plans a byte-for-byte add, then refreshes and selects the new theme without applying it', async () => {
    const b = schemeBridge()
    const controller = createSchemeController(b)
    await controller.load()
    expect(await controller.importFile(themeInput)).toBe(true)
    expect(b.adds).toEqual([{ gameRoot: 'D:/Game', kind: 'theme', ...themeInput, revision: 1 }])
    expect(b.calls).toContain('execute:plan-add:install:false')
    expect(b.calls).not.toContain('planScheme')
    const state = controller.getState()
    expect(state.themes.map(theme => theme.file)).toEqual(['Blue.json', 'Night.json'])
    expect(state.selected?.file).toBe('Night.json')
    expect(state.current).toBe('Old Theme')
    expect(state.message).toEqual({ key: 'scheme.import.selected', params: { file: 'Night.json' } })
    expect(state.message ? renderMsg('zh', state.message) : '').toMatch(/已添加「Night\.json」并选中/)
    expect(state.importing || state.applying).toBe(false)
  })

  it('shows an engine refusal in the sheet, not as a page error, and selects nothing', async () => {
    const b = schemeBridge({ planError: new Error('这个主题的内部名称是「Blue」，而游戏里的「Blue.json」已经叫这个名字。') })
    const controller = createSchemeController(b)
    await controller.load()
    expect(await controller.importFile(themeInput)).toBe(false)
    const state = controller.getState()
    expect(renderMsg('zh', state.importError!)).toMatch(/Blue\.json/)
    expect(state.error).toBeNull()
    expect(state.selected).toBeNull()
    expect(state.applying).toBe(false)
    controller.clearImportError()
    expect(controller.getState().importError).toBeNull()
  })

  it('never shows a coded English refusal as it is', async () => {
    const b = schemeBridge({ planError: Object.assign(new Error('Source changed after preview'), { issue: { code: 'PLAN_STALE', message: 'Source changed after preview' } }) })
    const controller = createSchemeController(b)
    await controller.load()
    await controller.importFile(themeInput)
    expect(renderMsg('zh', controller.getState().importError!)).toMatch(/预览之后发生了改变/)
  })

  it('reports a failed job with the engine message', async () => {
    const b = schemeBridge({ job: { state: 'failed', error: { code: 'WRITE_FAILED', message: '磁盘已满，文件没有添加。' } } })
    const controller = createSchemeController(b)
    await controller.load()
    expect(await controller.importFile(themeInput)).toBe(false)
    expect(renderMsg('zh', controller.getState().importError!)).toBe('磁盘已满，文件没有添加。')
  })

  it('treats an unknown result as unknown: the page locks until it is reconciled', async () => {
    const b = schemeBridge({ job: { state: 'unknown' } })
    const controller = createSchemeController(b)
    await controller.load()
    expect(await controller.importFile(themeInput)).toBe(false)
    expect(controller.getState().unresolved).toBe(true)
    expect(controller.getState().message).toBeNull()
    expect(await controller.importFile(themeInput)).toBe(false)
    expect(b.adds).toHaveLength(1)
    await controller.reconcile()
    expect(b.calls).toContain('reconcile')
    expect(controller.getState().unresolved).toBe(false)
  })

  it('holds every existing guard while the add is running', async () => {
    let release = () => {}
    const b = schemeBridge({ hold: new Promise<void>(resolve => { release = resolve }) })
    const controller = createSchemeController(b)
    await controller.load()
    const running = controller.importFile(themeInput)
    expect(controller.getState().applying).toBe(true)
    expect(controller.getState().importing).toBe(true)
    controller.open(controller.getState().themes[0]!)
    expect(controller.getState().selected).toBeNull()
    expect(await controller.importFile(themeInput)).toBe(false)
    release()
    expect(await running).toBe(true)
    expect(b.adds).toHaveLength(1)
  })

  it('opens the file picker for themes and survives a picker failure', async () => {
    const b = schemeBridge()
    const controller = createSchemeController(b)
    await controller.load()
    expect(await controller.pickImport('zh')).toBe('C:/Users/me/Downloads/picked')
    expect(b.calls).toContain('pickFile:theme')
    const failing = createSchemeController({ ...b, pickFile: async () => { throw new Error('dialog failed') } })
    await failing.load()
    expect(await failing.pickImport('zh')).toBeNull()
    const failingError = failing.getState().error
    expect(failingError ? renderMsg('zh', failingError) : '').toMatch(/无法打开文件选择/)
  })
})

describe('Audio: adding a sound from outside the game', () => {
  it('adds the sound, marks it as new and keeps every pending draft', async () => {
    const b = audioBridge()
    const controller = createAudioController(b)
    await controller.load()
    controller.open('kill')
    controller.add('hit')
    expect(await controller.importFile(soundInput)).toBe(true)
    expect(b.adds).toEqual([{ gameRoot: 'D:/Game', kind: 'sound', ...soundInput, revision: 1 }])
    expect(b.calls).not.toContain('planAudio')
    const state = controller.getState()
    expect(state.sounds.map(item => item.file)).toContain('Soft.wav')
    expect(state.lastAdded).toBe('Soft.wav')
    expect(state.event).toBe('kill')
    expect(state.draft).toEqual(['Bell5', 'hit'])
    expect(state.drafts.kill).toEqual(['Bell5', 'hit'])
    expect(state.message ? renderMsg('zh', state.message) : '').toMatch(/已添加音效「Soft\.wav」/)
  })

  it('shows a refusal in the sheet and keeps the drafts', async () => {
    const b = audioBridge({ planError: new Error('sounds 文件夹里已经有同名音效「hit.wav」。') })
    const controller = createAudioController(b)
    await controller.load()
    controller.open('kill')
    controller.add('hit')
    expect(await controller.importFile({ ...soundInput, file: 'hit.ogg' })).toBe(false)
    expect(renderMsg('zh', controller.getState().importError!)).toMatch(/hit\.wav/)
    expect(controller.getState().drafts.kill).toEqual(['Bell5', 'hit'])
    expect(controller.getState().lastAdded).toBeNull()
  })

  it('opens the file picker for sounds', async () => {
    const b = audioBridge()
    const controller = createAudioController(b)
    await controller.load()
    await controller.pickImport('zh')
    expect(b.calls).toContain('pickFile:sound')
  })
})
