import type { AudioBindings, AudioEvent, InstalledSound } from '../installer/contracts'
import { browserStorage } from '../i18n'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from '../workspace/game-root'
import { errorMsg } from '../workspace/issue-text'
import { t, type Lang, type MessageKey, type Msg } from '../i18n'
import { addFileToGame, type FileImportBridge, type FileImportInput, type FileImportState } from '../workspace/file-import'

/** The subset of the installer bridge that the Audio page needs. */
export interface AudioBridge extends FileImportBridge {
  discover(): Promise<{ candidates: string[] }>
  locate(gameRoot: string): Promise<{ gameRoot: string }>
  pickFolder(kind: 'game' | 'pack', lang: Lang): Promise<string | null>
  audioList(gameRoot: string): Promise<{ directory: string; sounds: InstalledSound[]; bindings: AudioBindings }>
  planAudio(input: { gameRoot: string; event: AudioEvent; names: string[]; revision: number }): Promise<{ planId: string }>
  execute(input: { operationId: string; planId: string; confirmation: 'install'; allowConflicts: boolean }): Promise<{ operationId: string }>
  job(operationId: string): Promise<{ state: string; result?: { status: string } | null; error?: { code: string; message: string; messageEn?: string } | null }>
  reconcile(operationId: string): Promise<unknown>
}

export type AudioPhase = 'idle' | 'locating' | 'needs-location' | 'loading' | 'ready' | 'error'
/** Kill and Spawn hold an ordered list; the four MBS events hold exactly one name. */
const LIST_EVENTS: AudioEvent[] = ['kill', 'spawn']
export const AUDIO_EVENTS: AudioEvent[] = ['kill', 'spawn', 'mbsGood', 'mbsOkay', 'mbsBad', 'mbsChangeNow']
/** The tab label key for each event; shared by the page (tabs) and this controller (messages). */
export const AUDIO_TAB_KEYS: Record<AudioEvent, MessageKey> = {
  kill: 'audio.tab.kill', spawn: 'audio.tab.spawn',
  mbsGood: 'audio.tab.mbsGood', mbsOkay: 'audio.tab.mbsOkay', mbsBad: 'audio.tab.mbsBad', mbsChangeNow: 'audio.tab.mbsChangeNow',
}

export interface AudioState extends FileImportState {
  phase: AudioPhase
  gameRoot: string | null
  candidates: string[]
  directory: string | null
  sounds: InstalledSound[]
  bindings: AudioBindings | null
  event: AudioEvent | null
  /** The selected event's working list: its draft, or its binding when there is no draft. */
  draft: string[]
  /** One unconfirmed edit per event. Only events that actually differ appear here, and a
   *  draft survives switching event or section until it is applied or discarded. */
  drafts: Partial<Record<AudioEvent, string[]>>
  applying: boolean
  unresolved: boolean
  message: Msg | null
  error: Msg | null
  /** The file the last import added, so the list can point at it. Cleared by the next load. */
  lastAdded: string | null
}

const empty = (): AudioBindings => ({ kill: [], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] })
/** Kill and Spawn get their own tab label; every MBS event shares one generic label in messages. */
const eventLabelKey = (event: AudioEvent): MessageKey => (event === 'kill' || event === 'spawn' ? AUDIO_TAB_KEYS[event] : 'audio.event.mbsGeneric')
/** A status code the engine returns, or none. A real code is language-neutral and sits in
 * either dictionary's template as-is; an absent one needs its own translated word, so this
 * builds the final bilingual pair directly instead of leaving `{status}` for later substitution. */
function incompleteMsg(status: string | undefined): Msg {
  if (status !== undefined) return { key: 'audio.error.incomplete', params: { status } }
  return {
    zh: t('zh', 'audio.error.incomplete', { status: t('zh', 'common.unknownStatus') }),
    en: t('en', 'audio.error.incomplete', { status: t('en', 'common.unknownStatus') }),
  }
}
/** `event`'s label, resolved in both languages and baked into the message; a `{key}` Msg would
 * otherwise carry the wrong language's label into whichever dictionary renders it. */
function appliedMsg(baseKey: 'audio.applied.noChange' | 'audio.applied.success', event: AudioEvent): Msg {
  const labelKey = eventLabelKey(event)
  return {
    zh: t('zh', baseKey, { label: t('zh', labelKey) }),
    en: t('en', baseKey, { label: t('en', labelKey) }),
  }
}

/** Owns the Audio page's current-configuration state. It never touches Profile drafts. */
export function createAudioController(bridge: AudioBridge, storage: GameRootStorage = browserStorage()) {
  let state: AudioState = {
    phase: 'idle', gameRoot: null, candidates: [], directory: null, sounds: [], bindings: null,
    event: null, draft: [], drafts: {}, applying: false, unresolved: false, message: null, error: null,
    importing: false, importError: null, lastAdded: null,
  }
  const listeners = new Set<() => void>()
  let revision = 0
  let operationId: string | null = null
  const publish = (patch: Partial<AudioState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  async function list(gameRoot: string): Promise<void> {
    const listing = await bridge.audioList(gameRoot)
    publish({ phase: 'ready', gameRoot, directory: listing.directory, sounds: listing.sounds, bindings: listing.bindings })
  }
  async function refresh(): Promise<void> {
    if (!state.gameRoot) return
    try { await list(state.gameRoot) } catch (error) { publish({ error: errorMsg(error, { key: 'audio.error.listSounds' }) }) }
  }
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((name, index) => name === b[index])
  const bindingOf = (event: AudioEvent) => [...(state.bindings?.[event] ?? [])]
  /** After a successful apply, that event has no pending edit; the others keep theirs. */
  const cleared = (event: AudioEvent) => {
    const drafts = { ...state.drafts }
    delete drafts[event]
    return { drafts, draft: bindingOf(event) }
  }
  const commit = (names: string[]) => {
    const event = state.event
    if (!event) return
    const drafts = { ...state.drafts }
    if (same(names, bindingOf(event))) delete drafts[event]
    else drafts[event] = names
    publish({ drafts, draft: names, error: null })
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async load(): Promise<void> {
      if (state.phase === 'locating' || state.applying) return
      publish({ phase: 'locating', error: null, message: null, lastAdded: null })
      try {
        const { gameRoot, candidates } = await resolveGameRoot(bridge, storage)
        if (gameRoot === null) {
          publish({ phase: 'needs-location', candidates, gameRoot: null })
          return
        }
        publish({ phase: 'loading', candidates })
        await list(gameRoot)
      } catch (error) { publish({ phase: 'error', error: errorMsg(error, { key: 'audio.error.locate' }) }) }
    },
    async chooseGameRoot(root: string): Promise<void> {
      publish({ phase: 'loading', error: null, message: null })
      try { await list(root); writeGameRoot(storage, root) } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'audio.error.readDirectory' }) }) }
    },
    async chooseFolder(lang: Lang): Promise<void> {
      try {
        const root = await bridge.pickFolder('game', lang)
        if (root) await this.chooseGameRoot(root)
      } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'audio.error.chooseFolder' }) }) }
    },
    open(event: AudioEvent): void {
      if (state.unresolved || state.applying || !state.bindings || !AUDIO_EVENTS.includes(event)) return
      publish({ event, draft: [...(state.drafts[event] ?? bindingOf(event))], error: null, message: null })
    },
    /** Leaves the editor. Drafts survive, so another event's pending edit is not lost. */
    close(): void { publish({ event: null, draft: [], error: null }) },
    /** 退出: discard only the selected event's draft. */
    discard(): void {
      const event = state.event
      if (!event || state.applying || state.unresolved) return
      const drafts = { ...state.drafts }
      delete drafts[event]
      publish({ drafts, draft: bindingOf(event), error: null })
    },
    pendingEvents(): AudioEvent[] { return AUDIO_EVENTS.filter(event => state.drafts[event] !== undefined) },
    add(name: string): boolean {
      if (state.unresolved || state.applying || !state.event) return false
      const sound = state.sounds.find(candidate => candidate.name === name)
      if (!sound) { publish({ error: { key: 'audio.error.notFound' } }); return false }
      if (sound.ambiguous) { publish({ error: { key: 'audio.error.ambiguous', params: { name } } }); return false }
      const isList = LIST_EVENTS.includes(state.event)
      if (!isList) { commit([name]); return true }
      commit([...state.draft, name])
      return true
    },
    /** 只用这个: a list event's whole list becomes this one sound. Still only a draft. */
    only(name: string): boolean {
      if (state.unresolved || state.applying || !state.event) return false
      const sound = state.sounds.find(candidate => candidate.name === name)
      if (!sound) { publish({ error: { key: 'audio.error.notFound' } }); return false }
      if (sound.ambiguous) { publish({ error: { key: 'audio.error.ambiguous', params: { name } } }); return false }
      commit([name])
      return true
    },
    replace(index: number, name: string): boolean {
      if (state.unresolved || state.applying || !state.event || index < 0 || index >= state.draft.length) return false
      const sound = state.sounds.find(candidate => candidate.name === name)
      if (!sound) { publish({ error: { key: 'audio.error.notFound' } }); return false }
      if (sound.ambiguous) { publish({ error: { key: 'audio.error.ambiguous', params: { name } } }); return false }
      const next = [...state.draft]
      next[index] = name
      commit(next)
      return true
    },
    remove(index: number): void {
      if (state.unresolved || state.applying || index < 0 || index >= state.draft.length) return
      commit(state.draft.filter((_, position) => position !== index))
    },
    move(index: number, offset: number): void {
      const target = index + offset
      if (state.unresolved || state.applying) return
      if (index < 0 || target < 0 || index >= state.draft.length || target >= state.draft.length) return
      const next = [...state.draft]
      const held = next[index]!
      next[index] = next[target]!
      next[target] = held
      commit(next)
    },
    clear(): void {
      if (state.unresolved || state.applying || !state.event) return
      if (!LIST_EVENTS.includes(state.event)) { publish({ error: { key: 'audio.error.singleOnly' } }); return }
      commit([])
    },
    async apply(): Promise<boolean> {
      const event = state.event
      if (!event || !state.gameRoot || state.applying || state.unresolved) return false
      const names = LIST_EVENTS.includes(event) ? [...state.draft] : state.draft.slice(0, 1)
      if (!LIST_EVENTS.includes(event) && names.length !== 1) { publish({ error: { key: 'audio.error.singleOnly' } }); return false }
      publish({ applying: true, error: null, message: null })
      const id = crypto.randomUUID()
      operationId = id
      try {
        const preview = await bridge.planAudio({ gameRoot: state.gameRoot, event, names, revision: ++revision })
        await bridge.execute({ operationId: id, planId: preview.planId, confirmation: 'install', allowConflicts: false })
        let job = await bridge.job(id)
        for (let attempt = 0; !['finished', 'failed', 'unknown', 'reconciled'].includes(job.state) && attempt < 240; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250))
          job = await bridge.job(id)
        }
        if (job.state === 'unknown') {
          publish({ applying: false, unresolved: true, error: { key: 'audio.error.unresolved' } })
          return false
        }
        if (job.state === 'failed') {
          await refresh()
          publish({ applying: false, error: errorMsg(job.error, { key: 'audio.error.applyFailed' }) })
          return false
        }
        const status = job.result?.status
        if (status === 'no-change') {
          operationId = null
          await refresh()
          publish({ applying: false, ...cleared(event), message: appliedMsg('audio.applied.noChange', event) })
          return true
        }
        if (status !== 'completed') {
          await refresh()
          publish({ applying: false, error: incompleteMsg(status) })
          return false
        }
        operationId = null
        await refresh()
        publish({ applying: false, ...cleared(event), message: appliedMsg('audio.applied.success', event) })
        return true
      } catch (error) {
        await refresh()
        publish({ applying: false, error: errorMsg(error, { key: 'audio.error.applyFailedGeneric' }) })
        return false
      }
    },
    /** Opens the sound file picker. The chosen file is only auditioned; nothing is written yet. */
    async pickImport(lang: Lang): Promise<string | null> {
      try { return await bridge.pickFile('sound', lang) } catch (error) { publish({ error: errorMsg(error, { key: 'audio.error.pickImport' }) }); return null }
    },
    clearImportError(): void { publish({ importError: null }) },
    /**
     * Adds an outside sound to the game's sounds folder. No binding changes and every pending
     * draft survives: the new sound only becomes available to bind.
     */
    async importFile(input: FileImportInput): Promise<boolean> {
      if (!state.gameRoot || state.applying || state.unresolved) return false
      publish({ applying: true, importing: true, importError: null, error: null, message: null })
      const id = crypto.randomUUID()
      operationId = id
      const outcome = await addFileToGame(bridge, id, { gameRoot: state.gameRoot, kind: 'sound', ...input, revision: ++revision })
      if (outcome.kind === 'unknown') {
        publish({ applying: false, importing: false, unresolved: true, error: { key: 'audio.error.importUnknown' } })
        return false
      }
      operationId = null
      await refresh()
      if (outcome.kind === 'refused') { publish({ applying: false, importing: false, importError: outcome.message }); return false }
      publish({ applying: false, importing: false, lastAdded: input.file, message: { key: 'audio.import.added', params: { file: input.file } } })
      return true
    },
    async reconcile(): Promise<void> {
      if (!operationId) { publish({ unresolved: false }); return }
      try {
        await bridge.reconcile(operationId)
        operationId = null
        await refresh()
        publish({ unresolved: false, error: null, message: { key: 'audio.applied.reconciled' } })
      } catch (error) { publish({ error: errorMsg(error, { key: 'audio.error.reconcileFailed' }) }) }
    },
    /** Test seam: the current bindings, defaulted so callers never read null. */
    getBindings(): AudioBindings { return state.bindings ?? empty() },
  }
}

export type AudioController = ReturnType<typeof createAudioController>
