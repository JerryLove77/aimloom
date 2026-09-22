import type { InstalledCrosshair } from '../installer/contracts'
import { browserStorage } from '../i18n'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from '../workspace/game-root'
import { errorMsg } from '../workspace/issue-text'
import { t, type Lang, type Msg } from '../i18n'
import { toBase64, toCanonicalPng, type RgbaDecoder } from './png'

/** The subset of the installer bridge that the Crosshair page needs. */
export interface CrosshairBridge {
  discover(): Promise<{ candidates: string[] }>
  locate(gameRoot: string): Promise<{ gameRoot: string }>
  pickFolder(kind: 'game' | 'pack', lang: Lang): Promise<string | null>
  crosshairList(gameRoot: string): Promise<{ directory: string; crosshairs: InstalledCrosshair[] }>
  planCrosshair(input: { gameRoot: string; file: string; pngBase64: string; revision: number }): Promise<{ planId: string }>
  planCrosshairAdd(input: { gameRoot: string; file: string; pngBase64: string; revision: number }): Promise<{ planId: string }>
  execute(input: { operationId: string; planId: string; confirmation: 'install'; allowConflicts: boolean }): Promise<{ operationId: string }>
  job(operationId: string): Promise<{ state: string; result?: { status: string } | null; error?: { code: string; message: string; messageEn?: string } | null }>
  reconcile(operationId: string): Promise<unknown>
  /** The native file dialog, filtered to PNG. */
  pickFile(kind: 'crosshair', lang: Lang): Promise<string | null>
}

export type CrosshairPhase = 'idle' | 'locating' | 'needs-location' | 'loading' | 'ready' | 'error'
/** Replacing an installed slot's image, or adding a new file beside them. */
export type CrosshairMode = 'replace' | 'add'
export interface CrosshairSource { name: string; path: string; pngBase64: string; width: number; height: number }
/** An image made inside the app (from a crosshair code), already a canonical PNG. */
export interface GeneratedCrosshair { label: string; pngBase64: string; width: number; height: number }

export interface CrosshairState {
  phase: CrosshairPhase
  gameRoot: string | null
  candidates: string[]
  directory: string | null
  slots: InstalledCrosshair[]
  /** The slot whose image is being replaced. The game's own selection is not known here. */
  mode: CrosshairMode
  slot: InstalledCrosshair | null
  /** The file name typed when adding; the extension is added for the user. */
  newName: string
  nameError: Msg | null
  source: CrosshairSource | null
  reading: boolean
  applying: boolean
  unresolved: boolean
  ready: boolean
  message: Msg | null
  error: Msg | null
}


const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
/** Mirrors the worker's Assert-KvkCrosshairTargetName so the page and the engine agree. */
export function crosshairNameIssue(raw: string): Msg | null {
  const value = raw.trim()
  if (!value) return { key: 'crosshair.name.enterName' }
  // The engine measures the whole file name, so .png counts toward the limit.
  if (toFileName(value).length > 128) return { key: 'crosshair.name.tooLong' }
  if (/[\\/:*?"<>|]/.test(value) || /[\u0000-\u001f]/.test(value)) return { key: 'crosshair.name.forbidden' }
  if (value.startsWith('.') || value.startsWith(' ') || value.endsWith('.') || value.endsWith(' ')) return { key: 'crosshair.name.spacesOrDots' }
  if (value.includes('..')) return { key: 'crosshair.name.doubleDot' }
  if (RESERVED.test(value.split('.')[0] ?? value)) return { key: 'crosshair.name.reserved' }
  return null
}
/** Accept either a bare name or one that already ends in .png. */
export function crosshairFileName(raw: string): string { return toFileName(raw) }
function toFileName(raw: string): string {
  const value = raw.trim()
  return /\.png$/i.test(value) ? value : `${value}.png`
}

const fileName = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path
/** A status code the engine returns, or none, mirroring scheme/audio's incompleteMsg. */
function incompleteMsg(adding: boolean, status: string | undefined): Msg {
  const key = adding ? 'crosshair.error.addIncomplete' as const : 'crosshair.error.replaceIncomplete' as const
  if (status !== undefined) return { key, params: { status } }
  return { zh: t('zh', key, { status: t('zh', 'common.unknownStatus') }), en: t('en', key, { status: t('en', 'common.unknownStatus') }) }
}

/** Owns the Crosshair page's current-configuration state. It never touches Profile drafts. */
export function createCrosshairController(bridge: CrosshairBridge, readSource: (path: string) => Promise<Uint8Array>, decode?: RgbaDecoder, storage: GameRootStorage = browserStorage()) {
  let state: CrosshairState = {
    phase: 'idle', gameRoot: null, candidates: [], directory: null, slots: [], mode: 'replace', slot: null,
    newName: '', nameError: null, source: null,
    reading: false, applying: false, unresolved: false, ready: false, message: null, error: null,
  }
  const listeners = new Set<() => void>()
  let revision = 0
  let operationId: string | null = null
  let sourceRequest = 0
  const publish = (patch: Partial<CrosshairState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  async function list(gameRoot: string): Promise<void> {
    const listing = await bridge.crosshairList(gameRoot)
    publish({ phase: 'ready', gameRoot, directory: listing.directory, slots: listing.crosshairs })
  }
  async function refresh(): Promise<void> {
    if (!state.gameRoot) return
    try { await list(state.gameRoot) } catch (error) { publish({ error: errorMsg(error, { key: 'crosshair.error.listCrosshairs' }) }) }
  }
  async function apply(): Promise<boolean> {
    if (state.applying || state.unresolved) return false
    const adding = state.mode === 'add'
    if (!adding && !state.slot) { publish({ error: { key: 'crosshair.error.selectSlot' } }); return false }
    if (!state.source || !state.ready) { publish({ error: { key: 'crosshair.error.selectSource' } }); return false }
    if (!state.gameRoot) { publish({ error: { key: 'crosshair.error.selectGameRoot' } }); return false }
    let file = ''
    if (adding) {
      const issue = crosshairNameIssue(state.newName)
      file = toFileName(state.newName)
      if (issue) { publish({ nameError: issue }); return false }
      if (state.slots.some(slot => slot.file.toLowerCase() === file.toLowerCase())) { publish({ nameError: { key: 'crosshair.name.taken' } }); return false }
    } else { file = state.slot!.file }
    const slot = state.slot
    const source = state.source
    publish({ applying: true, error: null, message: null })
    const id = crypto.randomUUID()
    operationId = id
    try {
      const preview = adding
        ? await bridge.planCrosshairAdd({ gameRoot: state.gameRoot, file, pngBase64: source.pngBase64, revision: ++revision })
        : await bridge.planCrosshair({ gameRoot: state.gameRoot, file, pngBase64: source.pngBase64, revision: ++revision })
      await bridge.execute({ operationId: id, planId: preview.planId, confirmation: 'install', allowConflicts: false })
      let job = await bridge.job(id)
      for (let attempt = 0; !['finished', 'failed', 'unknown', 'reconciled'].includes(job.state) && attempt < 240; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        job = await bridge.job(id)
      }
      if (job.state === 'unknown') {
        publish({ applying: false, unresolved: true, error: { key: 'crosshair.error.unresolved' } })
        return false
      }
      if (job.state === 'failed') {
        await refresh()
        publish({ applying: false, error: errorMsg(job.error, { key: adding ? 'crosshair.error.addFailed' : 'crosshair.error.replaceFailed' }) })
        return false
      }
      const status = job.result?.status
      if (status === 'no-change') {
        operationId = null
        await refresh()
        publish({ applying: false, mode: 'replace', slot: null, source: null, ready: false, message: { key: 'crosshair.applied.noChange' } })
        return true
      }
      if (status !== 'completed') {
        await refresh()
        publish({ applying: false, error: incompleteMsg(adding, status) })
        return false
      }
      operationId = null
      await refresh()
      publish({ applying: false, mode: 'replace', slot: null, newName: '', nameError: null, source: null, ready: false,
        message: adding
          ? { key: 'crosshair.applied.added', params: { file } }
          : { key: 'crosshair.applied.replaced', params: { file } } })
      return true
    } catch (error) {
      await refresh()
      publish({ applying: false, error: errorMsg(error, { key: adding ? 'crosshair.error.addFailedGeneric' : 'crosshair.error.replaceFailedGeneric' }) })
      return false
    }
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async load(): Promise<void> {
      if (state.phase === 'locating' || state.applying) return
      publish({ phase: 'locating', error: null, message: null })
      try {
        const { gameRoot, candidates } = await resolveGameRoot(bridge, storage)
        if (gameRoot === null) {
          publish({ phase: 'needs-location', candidates, gameRoot: null })
          return
        }
        publish({ phase: 'loading', candidates })
        await list(gameRoot)
      } catch (error) { publish({ phase: 'error', error: errorMsg(error, { key: 'crosshair.error.locate' }) }) }
    },
    async chooseGameRoot(root: string): Promise<void> {
      publish({ phase: 'loading', error: null, message: null })
      try { await list(root); writeGameRoot(storage, root) } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'crosshair.error.readDirectory' }) }) }
    },
    async chooseFolder(lang: Lang): Promise<void> {
      try {
        const root = await bridge.pickFolder('game', lang)
        if (root) await this.chooseGameRoot(root)
      } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'crosshair.error.chooseFolder' }) }) }
    },
    open(slot: InstalledCrosshair): void {
      if (state.unresolved || state.applying) return
      publish({ mode: 'replace', slot, newName: '', nameError: null, source: null, ready: false, error: null, message: null })
    },
    startAdd(): void {
      if (state.unresolved || state.applying) return
      publish({ mode: 'add', slot: null, newName: '', nameError: null, source: null, ready: false, error: null, message: null })
    },
    setNewName(raw: string): void {
      if (state.unresolved || state.applying || state.mode !== 'add') return
      const issue = crosshairNameIssue(raw)
      const file = toFileName(raw)
      const exists = issue === null && state.slots.some(slot => slot.file.toLowerCase() === file.toLowerCase())
      publish({ newName: raw, nameError: issue ?? (exists ? { key: 'crosshair.name.taken' } : null) })
    },
    close(): void { publish({ mode: 'replace', slot: null, newName: '', nameError: null, source: null, ready: false, error: null }) },
    async chooseSource(path: string): Promise<void> {
      if (state.unresolved || state.applying) return
      if (state.mode === 'replace' && !state.slot) return
      const request = ++sourceRequest
      publish({ reading: true, source: null, ready: false, error: null })
      try {
        const bytes = await readSource(path)
        if (request !== sourceRequest) return
        const canonical = await toCanonicalPng(bytes, decode)
        if (request !== sourceRequest) return
        const view = new DataView(canonical.buffer, canonical.byteOffset, canonical.byteLength)
        publish({ reading: false, ready: true, source: { name: fileName(path), path, pngBase64: toBase64(canonical), width: view.getUint32(16), height: view.getUint32(20) } })
      } catch (error) {
        if (request !== sourceRequest) return
        publish({ reading: false, source: null, ready: false, error: errorMsg(error, { key: 'crosshair.error.useImage' }) })
      }
    },
    apply,
    /**
     * Adds an image made inside the app under the name already typed for add mode. It shares
     * apply()'s plan, execute and job path: a native session holds one plan and one job, so a
     * second pipeline would race this one.
     */
    async addGenerated(image: GeneratedCrosshair): Promise<boolean> {
      if (state.unresolved || state.applying || state.mode !== 'add') return false
      sourceRequest++ // a file read still in flight must not replace this source
      publish({ reading: false, ready: true, error: null, source: { name: image.label, path: '', pngBase64: image.pngBase64, width: image.width, height: image.height } })
      return apply()
    },
    async reconcile(): Promise<void> {
      if (!operationId) { publish({ unresolved: false }); return }
      try {
        await bridge.reconcile(operationId)
        operationId = null
        await refresh()
        // The page's sheets follow the choice, so clearing it keeps a sheet from reopening.
        publish({ unresolved: false, error: null, message: { key: 'crosshair.applied.reconciled' }, mode: 'replace', slot: null, newName: '', nameError: null, source: null, ready: false })
      } catch (error) { publish({ error: errorMsg(error, { key: 'crosshair.error.reconcileFailed' }) }) }
    },
  }
}

export type CrosshairController = ReturnType<typeof createCrosshairController>
