import type { ThemeList, ThemeEntry } from '../bridge/contracts'
import { browserStorage, type Lang } from '../i18n'
import type { GameRootStorage } from '../section/game-root'
import { errorMsg } from '../section/issue-text'
import { createSection, IDLE_SECTION, type SectionBridge, type SectionPhase, type SectionState } from '../section/controller'
import { addFileToGame, type FileImportBridge, type FileImportInput, type FileImportState } from '../section/file-import'

/** The subset of the installer bridge that the Theme page needs. */
export interface ThemeBridge extends SectionBridge, FileImportBridge {
  themeList(gameRoot: string): Promise<ThemeList>
  planTheme(input: { gameRoot: string; file: string; revision: number }): Promise<{ planId: string }>
}

export type ThemePhase = SectionPhase

export interface ThemeState extends SectionState, FileImportState {
  directory: string | null
  themes: ThemeEntry[]
  current: string | null
  selected: ThemeEntry | null
}

/** Owns the Theme page's current-configuration state. It never touches Profile drafts. */
export function createThemeController(bridge: ThemeBridge, storage: GameRootStorage = browserStorage()) {
  const section = createSection<ThemeState>(bridge, storage, {
    initial: { ...IDLE_SECTION, directory: null, themes: [], current: null, selected: null, importing: false, importError: null },
    keys: {
      locate: 'theme.error.locate', readDirectory: 'theme.error.readDirectory', chooseFolder: 'theme.error.chooseFolder',
      list: 'theme.error.listThemes', reconciled: 'theme.applied.reconciled', reconcileFailed: 'theme.error.reconcileFailed',
    },
    async list(gameRoot) {
      const listing = await bridge.themeList(gameRoot)
      return { directory: listing.directory, themes: listing.themes, current: listing.current }
    },
  })
  const { getState, publish } = section
  return {
    getState,
    subscribe: section.subscribe,
    load: section.load,
    chooseGameRoot: section.chooseGameRoot,
    chooseFolder: section.chooseFolder,
    open(theme: ThemeEntry): void {
      const state = getState()
      if (state.unresolved || state.applying) return
      if (!theme.readable) { publish({ error: { key: 'theme.error.unreadable' } }); return }
      if (theme.duplicateName) { publish({ error: { key: 'theme.error.duplicateName' } }); return }
      publish({ selected: theme, error: null, message: null })
    },
    close(): void { publish({ selected: null, error: null }) },
    async apply(): Promise<boolean> {
      const { selected: theme, gameRoot, applying, unresolved } = getState()
      if (!theme || !gameRoot || applying || unresolved) return false
      return section.apply({
        plan: revision => bridge.planTheme({ gameRoot, file: theme.file, revision }),
        keys: { unresolved: 'theme.error.unresolved', failed: 'theme.error.applyFailed', incomplete: 'theme.error.incomplete', failedGeneric: 'theme.error.applyFailedGeneric' },
        done: status => status === 'completed'
          ? { selected: null, current: theme.name, message: { key: 'theme.applied.success' } }
          : { selected: null, message: { key: 'theme.applied.noChange' } },
      })
    },
    /** Opens the theme file picker. The chosen file is only previewed; nothing is written yet. */
    async pickImport(lang: Lang): Promise<string | null> {
      try { return await bridge.pickFile('theme', lang) } catch (error) { publish({ error: errorMsg(error, { key: 'theme.error.pickImport' }) }); return null }
    },
    clearImportError(): void { publish({ importError: null }) },
    /**
     * Adds an outside theme to the game's Themes folder, then selects it as the pending choice.
     * It changes which files are installed, never what is in effect: Apply background is still needed.
     */
    async importFile(input: FileImportInput): Promise<boolean> {
      const { gameRoot, applying, unresolved } = getState()
      if (!gameRoot || applying || unresolved) return false
      publish({ applying: true, importing: true, importError: null, error: null, message: null })
      const id = section.startOperation()
      const outcome = await addFileToGame(bridge, id, { gameRoot, kind: 'theme', ...input, revision: section.nextRevision() })
      if (outcome.kind === 'unknown') {
        publish({ applying: false, importing: false, unresolved: true, error: { key: 'theme.error.importUnknown' } })
        return false
      }
      section.finishOperation()
      await section.refresh()
      if (outcome.kind === 'refused') { publish({ applying: false, importing: false, importError: outcome.message }); return false }
      const added = getState().themes.find(theme => theme.file.toLowerCase() === input.file.toLowerCase())
      const usable = added && added.readable && !added.duplicateName ? added : null
      publish({
        applying: false, importing: false, selected: usable ?? getState().selected,
        message: usable ? { key: 'theme.import.selected', params: { file: input.file } } : { key: 'theme.import.added', params: { file: input.file } },
      })
      return true
    },
    reconcile: section.reconcile,
  }
}

export type ThemeController = ReturnType<typeof createThemeController>
