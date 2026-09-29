import type { InstalledCrosshair } from '../bridge/contracts'
import { browserStorage, type Lang, type Msg } from '../i18n'
import type { GameRootStorage } from '../section/game-root'
import { errorMsg } from '../section/issue-text'
import { createSection, IDLE_SECTION, type SectionBridge, type SectionPhase, type SectionState } from '../section/controller'
import { toBase64, toCanonicalPng, type RgbaDecoder } from './png'

/** The subset of the installer bridge that the Crosshair page needs. */
export interface CrosshairBridge extends SectionBridge {
  crosshairList(gameRoot: string): Promise<{ directory: string; crosshairs: InstalledCrosshair[] }>
  planCrosshair(input: { gameRoot: string; file: string; pngBase64: string; revision: number }): Promise<{ planId: string }>
  planCrosshairAdd(input: { gameRoot: string; file: string; pngBase64: string; revision: number }): Promise<{ planId: string }>
  /** The native file dialog, filtered to PNG. */
  pickFile(kind: 'crosshair', lang: Lang): Promise<string | null>
}

export type CrosshairPhase = SectionPhase
/** Replacing an installed slot's image, or adding a new file beside them. */
export type CrosshairMode = 'replace' | 'add'
export interface CrosshairSource { name: string; path: string; pngBase64: string; width: number; height: number }
/** An image made inside the app (from a crosshair code), already a canonical PNG. */
export interface GeneratedCrosshair { label: string; pngBase64: string; width: number; height: number }

export interface CrosshairState extends SectionState {
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
  ready: boolean
}

/** No slot, name or source: what closing, or finishing, a crosshair sheet leaves. */
const NO_CHOICE = { mode: 'replace', slot: null, newName: '', nameError: null, source: null, ready: false } as const

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
/** Owns the Crosshair page's current-configuration state. It never touches Profile drafts. */
export function createCrosshairController(bridge: CrosshairBridge, readSource: (path: string) => Promise<Uint8Array>, decode?: RgbaDecoder, storage: GameRootStorage = browserStorage()) {
  const section = createSection<CrosshairState>(bridge, storage, {
    initial: { ...IDLE_SECTION, directory: null, slots: [], ...NO_CHOICE, reading: false },
    keys: {
      locate: 'crosshair.error.locate', readDirectory: 'crosshair.error.readDirectory', chooseFolder: 'crosshair.error.chooseFolder',
      list: 'crosshair.error.listCrosshairs', reconciled: 'crosshair.applied.reconciled', reconcileFailed: 'crosshair.error.reconcileFailed',
    },
    async list(gameRoot) {
      const listing = await bridge.crosshairList(gameRoot)
      return { directory: listing.directory, slots: listing.crosshairs }
    },
    // The page's sheets follow the choice, so clearing it keeps a sheet from reopening.
    onReconciled: NO_CHOICE,
  })
  const { getState, publish } = section
  let sourceRequest = 0
  async function apply(): Promise<boolean> {
    const state = getState()
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
    const { gameRoot, source } = state
    return section.apply({
      plan: revision => adding
        ? bridge.planCrosshairAdd({ gameRoot, file, pngBase64: source.pngBase64, revision })
        : bridge.planCrosshair({ gameRoot, file, pngBase64: source.pngBase64, revision }),
      keys: adding
        ? { unresolved: 'crosshair.error.unresolved', failed: 'crosshair.error.addFailed', incomplete: 'crosshair.error.addIncomplete', failedGeneric: 'crosshair.error.addFailedGeneric' }
        : { unresolved: 'crosshair.error.unresolved', failed: 'crosshair.error.replaceFailed', incomplete: 'crosshair.error.replaceIncomplete', failedGeneric: 'crosshair.error.replaceFailedGeneric' },
      done: status => status === 'no-change'
        ? { mode: 'replace', slot: null, source: null, ready: false, message: { key: 'crosshair.applied.noChange' } }
        : { ...NO_CHOICE, message: adding ? { key: 'crosshair.applied.added', params: { file } } : { key: 'crosshair.applied.replaced', params: { file } } },
    })
  }
  return {
    getState,
    subscribe: section.subscribe,
    load: section.load,
    chooseGameRoot: section.chooseGameRoot,
    chooseFolder: section.chooseFolder,
    open(slot: InstalledCrosshair): void {
      const state = getState()
      if (state.unresolved || state.applying) return
      publish({ ...NO_CHOICE, slot, error: null, message: null })
    },
    startAdd(): void {
      const state = getState()
      if (state.unresolved || state.applying) return
      publish({ ...NO_CHOICE, mode: 'add', error: null, message: null })
    },
    setNewName(raw: string): void {
      const state = getState()
      if (state.unresolved || state.applying || state.mode !== 'add') return
      const issue = crosshairNameIssue(raw)
      const file = toFileName(raw)
      const exists = issue === null && state.slots.some(slot => slot.file.toLowerCase() === file.toLowerCase())
      publish({ newName: raw, nameError: issue ?? (exists ? { key: 'crosshair.name.taken' } : null) })
    },
    close(): void { publish({ ...NO_CHOICE, error: null }) },
    async chooseSource(path: string): Promise<void> {
      const state = getState()
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
      const state = getState()
      if (state.unresolved || state.applying || state.mode !== 'add') return false
      sourceRequest++ // a file read still in flight must not replace this source
      publish({ reading: false, ready: true, error: null, source: { name: image.label, path: '', pngBase64: image.pngBase64, width: image.width, height: image.height } })
      return apply()
    },
    reconcile: section.reconcile,
  }
}

export type CrosshairController = ReturnType<typeof createCrosshairController>
