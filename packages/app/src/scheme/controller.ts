import type { SchemeList, SchemeTheme } from '../installer/contracts'
import { browserStorage } from '../i18n'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from '../workspace/game-root'
import { errorMsg } from '../workspace/issue-text'
import { t, type Lang, type Msg } from '../i18n'
import { addFileToGame, type FileImportBridge, type FileImportInput, type FileImportState } from '../workspace/file-import'

/** The subset of the installer bridge that the Scheme page needs. */
export interface SchemeBridge extends FileImportBridge {
  discover(): Promise<{ candidates: string[] }>
  locate(gameRoot: string): Promise<{ gameRoot: string }>
  pickFolder(kind: 'game' | 'pack', lang: Lang): Promise<string | null>
  schemeList(gameRoot: string): Promise<SchemeList>
  planScheme(input: { gameRoot: string; file: string; revision: number }): Promise<{ planId: string }>
  execute(input: { operationId: string; planId: string; confirmation: 'install'; allowConflicts: boolean }): Promise<{ operationId: string }>
  job(operationId: string): Promise<{ state: string; result?: { status: string } | null; error?: { code: string; message: string; messageEn?: string } | null }>
  reconcile(operationId: string): Promise<unknown>
}

export type SchemePhase = 'idle' | 'locating' | 'needs-location' | 'loading' | 'ready' | 'error'

export interface SchemeState extends FileImportState {
  phase: SchemePhase
  gameRoot: string | null
  candidates: string[]
  directory: string | null
  themes: SchemeTheme[]
  current: string | null
  selected: SchemeTheme | null
  applying: boolean
  /** An operation whose outcome is not yet known; the page stays locked until reconciliation. */
  unresolved: boolean
  message: Msg | null
  error: Msg | null
}

/** A status code the engine returns, or none. A real code is language-neutral and sits in
 * either dictionary's template as-is; an absent one needs its own translated word, so this
 * builds the final bilingual pair directly instead of leaving `{status}` for later substitution. */
function incompleteMsg(status: string | undefined): Msg {
  if (status !== undefined) return { key: 'scheme.error.incomplete', params: { status } }
  return {
    zh: t('zh', 'scheme.error.incomplete', { status: t('zh', 'common.unknownStatus') }),
    en: t('en', 'scheme.error.incomplete', { status: t('en', 'common.unknownStatus') }),
  }
}

/** Owns the Scheme page's current-configuration state. It never touches Profile drafts. */
export function createSchemeController(bridge: SchemeBridge, storage: GameRootStorage = browserStorage()) {
  let state: SchemeState = {
    phase: 'idle', gameRoot: null, candidates: [], directory: null, themes: [], current: null,
    selected: null, applying: false, unresolved: false, message: null, error: null, importing: false, importError: null,
  }
  const listeners = new Set<() => void>()
  let revision = 0
  let operationId: string | null = null
  const publish = (patch: Partial<SchemeState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  async function list(gameRoot: string): Promise<void> {
    const listing = await bridge.schemeList(gameRoot)
    publish({ phase: 'ready', gameRoot, directory: listing.directory, themes: listing.themes, current: listing.current })
  }
  async function refresh(): Promise<void> {
    if (!state.gameRoot) return
    try { await list(state.gameRoot) } catch (error) { publish({ error: errorMsg(error, { key: 'scheme.error.listThemes' }) }) }
  }
  const terminal = (jobState: string) => ['finished', 'failed', 'unknown', 'reconciled'].includes(jobState)
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
      } catch (error) {
        publish({ phase: 'error', error: errorMsg(error, { key: 'scheme.error.locate' }) })
      }
    },
    async chooseGameRoot(root: string): Promise<void> {
      publish({ phase: 'loading', error: null, message: null })
      try { await list(root); writeGameRoot(storage, root) } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'scheme.error.readDirectory' }) }) }
    },
    async chooseFolder(lang: Lang): Promise<void> {
      try {
        const root = await bridge.pickFolder('game', lang)
        if (!root) return
        await this.chooseGameRoot(root)
      } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'scheme.error.chooseFolder' }) }) }
    },
    open(theme: SchemeTheme): void {
      if (state.unresolved || state.applying) return
      if (!theme.readable) { publish({ error: { key: 'scheme.error.unreadable' } }); return }
      if (theme.duplicateName) { publish({ error: { key: 'scheme.error.duplicateName' } }); return }
      publish({ selected: theme, error: null, message: null })
    },
    close(): void { publish({ selected: null, error: null }) },
    async apply(): Promise<boolean> {
      const theme = state.selected
      if (!theme || !state.gameRoot || state.applying || state.unresolved) return false
      publish({ applying: true, error: null, message: null })
      const id = crypto.randomUUID()
      operationId = id
      try {
        const preview = await bridge.planScheme({ gameRoot: state.gameRoot, file: theme.file, revision: ++revision })
        await bridge.execute({ operationId: id, planId: preview.planId, confirmation: 'install', allowConflicts: false })
        let job = await bridge.job(id)
        for (let attempt = 0; !terminal(job.state) && attempt < 240; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250))
          job = await bridge.job(id)
        }
        if (job.state === 'unknown') {
          publish({ applying: false, unresolved: true, error: { key: 'scheme.error.unresolved' } })
          return false
        }
        if (job.state === 'failed') {
          await refresh()
          publish({ applying: false, error: errorMsg(job.error, { key: 'scheme.error.applyFailed' }) })
          return false
        }
        const status = job.result?.status
        if (status === 'no-change') {
          operationId = null
          await refresh()
          publish({ applying: false, selected: null, message: { key: 'scheme.applied.noChange' } })
          return true
        }
        if (status !== 'completed') {
          await refresh()
          publish({ applying: false, error: incompleteMsg(status) })
          return false
        }
        operationId = null
        await refresh()
        publish({ applying: false, selected: null, current: theme.name, message: { key: 'scheme.applied.success' } })
        return true
      } catch (error) {
        await refresh()
        publish({ applying: false, error: errorMsg(error, { key: 'scheme.error.applyFailedGeneric' }) })
        return false
      }
    },
    /** Opens the theme file picker. The chosen file is only previewed; nothing is written yet. */
    async pickImport(lang: Lang): Promise<string | null> {
      try { return await bridge.pickFile('theme', lang) } catch (error) { publish({ error: errorMsg(error, { key: 'scheme.error.pickImport' }) }); return null }
    },
    clearImportError(): void { publish({ importError: null }) },
    /**
     * Adds an outside theme to the game's Themes folder, then selects it as the pending choice.
     * It changes which files are installed, never what is in effect: Apply background is still needed.
     */
    async importFile(input: FileImportInput): Promise<boolean> {
      if (!state.gameRoot || state.applying || state.unresolved) return false
      publish({ applying: true, importing: true, importError: null, error: null, message: null })
      const id = crypto.randomUUID()
      operationId = id
      const outcome = await addFileToGame(bridge, id, { gameRoot: state.gameRoot, kind: 'theme', ...input, revision: ++revision })
      if (outcome.kind === 'unknown') {
        publish({ applying: false, importing: false, unresolved: true, error: { key: 'scheme.error.importUnknown' } })
        return false
      }
      operationId = null
      await refresh()
      if (outcome.kind === 'refused') { publish({ applying: false, importing: false, importError: outcome.message }); return false }
      const added = state.themes.find(theme => theme.file.toLowerCase() === input.file.toLowerCase())
      const usable = added && added.readable && !added.duplicateName ? added : null
      publish({
        applying: false, importing: false, selected: usable ?? state.selected,
        message: usable ? { key: 'scheme.import.selected', params: { file: input.file } } : { key: 'scheme.import.added', params: { file: input.file } },
      })
      return true
    },
    async reconcile(): Promise<void> {
      if (!operationId) { publish({ unresolved: false }); return }
      try {
        await bridge.reconcile(operationId)
        operationId = null
        await refresh()
        publish({ unresolved: false, error: null, message: { key: 'scheme.applied.reconciled' } })
      } catch (error) { publish({ error: errorMsg(error, { key: 'scheme.error.reconcileFailed' }) }) }
    },
  }
}

export type SchemeController = ReturnType<typeof createSchemeController>
