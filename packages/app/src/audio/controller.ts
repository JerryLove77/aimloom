import { AUDIO_EVENTS, type AudioBindings, type AudioEvent, type InstalledSound } from '../bridge/contracts'
import { browserStorage, t, type Lang, type MessageKey, type Msg } from '../i18n'
import type { GameRootStorage } from '../section/game-root'
import { errorMsg } from '../section/issue-text'
import { createSection, IDLE_SECTION, type SectionBridge, type SectionPhase, type SectionState } from '../section/controller'
import { addFileToGame, type FileImportBridge, type FileImportInput, type FileImportState } from '../section/file-import'

/** The subset of the installer bridge that the Audio page needs. */
export interface AudioBridge extends SectionBridge, FileImportBridge {
  audioList(gameRoot: string): Promise<{ directory: string; sounds: InstalledSound[]; bindings: AudioBindings }>
  planAudio(input: { gameRoot: string; event: AudioEvent; names: string[]; revision: number }): Promise<{ planId: string }>
}

export type AudioPhase = SectionPhase
/** Kill and Spawn hold an ordered list; the four MBS events hold exactly one name. */
const LIST_EVENTS: AudioEvent[] = ['kill', 'spawn']
/** The tab label key for each event; shared by the page (tabs) and this controller (messages). */
export const AUDIO_TAB_KEYS: Record<AudioEvent, MessageKey> = {
  kill: 'audio.tab.kill', spawn: 'audio.tab.spawn',
  mbsGood: 'audio.tab.mbsGood', mbsOkay: 'audio.tab.mbsOkay', mbsBad: 'audio.tab.mbsBad', mbsChangeNow: 'audio.tab.mbsChangeNow',
}

export interface AudioState extends SectionState, FileImportState {
  directory: string | null
  sounds: InstalledSound[]
  bindings: AudioBindings | null
  event: AudioEvent | null
  /** The selected event's working list: its draft, or its binding when there is no draft. */
  draft: string[]
  /** One unconfirmed edit per event. Only events that actually differ appear here, and a
   *  draft survives switching event or section until it is applied or discarded. */
  drafts: Partial<Record<AudioEvent, string[]>>
  /** The file the last import added, so the list can point at it. Cleared by the next load. */
  lastAdded: string | null
}

const empty = (): AudioBindings => ({ kill: [], spawn: [], mbsGood: [], mbsOkay: [], mbsBad: [], mbsChangeNow: [] })
/** Kill and Spawn get their own tab label; every MBS event shares one generic label in messages. */
const eventLabelKey = (event: AudioEvent): MessageKey => (event === 'kill' || event === 'spawn' ? AUDIO_TAB_KEYS[event] : 'audio.event.mbsGeneric')
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
  const section = createSection<AudioState>(bridge, storage, {
    initial: {
      ...IDLE_SECTION, directory: null, sounds: [], bindings: null, event: null, draft: [], drafts: {},
      importing: false, importError: null, lastAdded: null,
    },
    keys: {
      locate: 'audio.error.locate', readDirectory: 'audio.error.readDirectory', chooseFolder: 'audio.error.chooseFolder',
      list: 'audio.error.listSounds', reconciled: 'audio.applied.reconciled', reconcileFailed: 'audio.error.reconcileFailed',
    },
    async list(gameRoot) {
      const listing = await bridge.audioList(gameRoot)
      return { directory: listing.directory, sounds: listing.sounds, bindings: listing.bindings }
    },
    onLoad: { lastAdded: null },
  })
  const { getState, publish } = section
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((name, index) => name === b[index])
  const bindingOf = (event: AudioEvent) => [...(getState().bindings?.[event] ?? [])]
  /** After a successful apply, that event has no pending edit; the others keep theirs. */
  const cleared = (event: AudioEvent) => {
    const drafts = { ...getState().drafts }
    delete drafts[event]
    return { drafts, draft: bindingOf(event) }
  }
  const commit = (names: string[]) => {
    const event = getState().event
    if (!event) return
    const drafts = { ...getState().drafts }
    if (same(names, bindingOf(event))) delete drafts[event]
    else drafts[event] = names
    publish({ drafts, draft: names, error: null })
  }
  /** The installed sound called `name`, or an error on the page when it cannot be used. */
  const usable = (name: string): boolean => {
    const sound = getState().sounds.find(candidate => candidate.name === name)
    if (!sound) { publish({ error: { key: 'audio.error.notFound' } }); return false }
    if (sound.ambiguous) { publish({ error: { key: 'audio.error.ambiguous', params: { name } } }); return false }
    return true
  }
  return {
    getState,
    subscribe: section.subscribe,
    load: section.load,
    chooseGameRoot: section.chooseGameRoot,
    chooseFolder: section.chooseFolder,
    open(event: AudioEvent): void {
      const state = getState()
      if (state.unresolved || state.applying || !state.bindings || !AUDIO_EVENTS.includes(event)) return
      publish({ event, draft: [...(state.drafts[event] ?? bindingOf(event))], error: null, message: null })
    },
    /** Leaves the editor. Drafts survive, so another event's pending edit is not lost. */
    close(): void { publish({ event: null, draft: [], error: null }) },
    /** 退出: discard only the selected event's draft. */
    discard(): void {
      const { event, applying, unresolved } = getState()
      if (!event || applying || unresolved) return
      const drafts = { ...getState().drafts }
      delete drafts[event]
      publish({ drafts, draft: bindingOf(event), error: null })
    },
    pendingEvents(): AudioEvent[] { return AUDIO_EVENTS.filter(event => getState().drafts[event] !== undefined) },
    add(name: string): boolean {
      const state = getState()
      if (state.unresolved || state.applying || !state.event) return false
      if (!usable(name)) return false
      const isList = LIST_EVENTS.includes(state.event)
      if (!isList) { commit([name]); return true }
      commit([...state.draft, name])
      return true
    },
    /** 只用这个: a list event's whole list becomes this one sound. Still only a draft. */
    only(name: string): boolean {
      const state = getState()
      if (state.unresolved || state.applying || !state.event) return false
      if (!usable(name)) return false
      commit([name])
      return true
    },
    replace(index: number, name: string): boolean {
      const state = getState()
      if (state.unresolved || state.applying || !state.event || index < 0 || index >= state.draft.length) return false
      if (!usable(name)) return false
      const next = [...state.draft]
      next[index] = name
      commit(next)
      return true
    },
    remove(index: number): void {
      const state = getState()
      if (state.unresolved || state.applying || index < 0 || index >= state.draft.length) return
      commit(state.draft.filter((_, position) => position !== index))
    },
    move(index: number, offset: number): void {
      const state = getState()
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
      const state = getState()
      if (state.unresolved || state.applying || !state.event) return
      if (!LIST_EVENTS.includes(state.event)) { publish({ error: { key: 'audio.error.singleOnly' } }); return }
      commit([])
    },
    async apply(): Promise<boolean> {
      const { event, gameRoot, applying, unresolved, draft } = getState()
      if (!event || !gameRoot || applying || unresolved) return false
      const names = LIST_EVENTS.includes(event) ? [...draft] : draft.slice(0, 1)
      if (!LIST_EVENTS.includes(event) && names.length !== 1) { publish({ error: { key: 'audio.error.singleOnly' } }); return false }
      return section.apply({
        plan: revision => bridge.planAudio({ gameRoot, event, names, revision }),
        keys: { unresolved: 'audio.error.unresolved', failed: 'audio.error.applyFailed', incomplete: 'audio.error.incomplete', failedGeneric: 'audio.error.applyFailedGeneric' },
        done: status => ({ ...cleared(event), message: appliedMsg(status === 'completed' ? 'audio.applied.success' : 'audio.applied.noChange', event) }),
      })
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
      const { gameRoot, applying, unresolved } = getState()
      if (!gameRoot || applying || unresolved) return false
      publish({ applying: true, importing: true, importError: null, error: null, message: null })
      const id = section.startOperation()
      const outcome = await addFileToGame(bridge, id, { gameRoot, kind: 'sound', ...input, revision: section.nextRevision() })
      if (outcome.kind === 'unknown') {
        publish({ applying: false, importing: false, unresolved: true, error: { key: 'audio.error.importUnknown' } })
        return false
      }
      section.finishOperation()
      await section.refresh()
      if (outcome.kind === 'refused') { publish({ applying: false, importing: false, importError: outcome.message }); return false }
      publish({ applying: false, importing: false, lastAdded: input.file, message: { key: 'audio.import.added', params: { file: input.file } } })
      return true
    },
    reconcile: section.reconcile,
    /** Test seam: the current bindings, defaulted so callers never read null. */
    getBindings(): AudioBindings { return getState().bindings ?? empty() },
  }
}

export type AudioController = ReturnType<typeof createAudioController>
