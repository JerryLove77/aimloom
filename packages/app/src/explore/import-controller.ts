import type { FileRow, InstallerBridge, Preview, Progress } from '../bridge/contracts'
import type { Lang, Msg } from '../i18n'
import { createStore } from '../section/controller'
import { errorMsg } from '../section/issue-text'
import { incompleteMsg } from '../section/run-plan'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from '../section/game-root'

/**
 * Quick import (beta2): drop or pick → one summary → 加进游戏. The engine reads the paths and
 * decides what each is (`planImport`); this owns the page's state transitions only.
 *
 * - `idle`: nothing chosen yet (Explore's cards show).
 * - `locating` / `needs-location`: the game folder, found the way every section finds it.
 * - `planning` → `ready`: the preview is on screen. A changed choice (new paths, the Advanced
 *   switch, another game folder) plans again; an older answer never overwrites a newer one.
 * - `adding`: the reviewed plan runs; navigation is locked.
 * - `done`: the outcome. `unresolved` keeps the page locked until `reconcile`.
 * - `blocked`: the engine refused to plan because the game runs or a batch must be recovered.
 */
export type ImportPhase = 'idle' | 'locating' | 'needs-location' | 'planning' | 'ready' | 'adding' | 'done' | 'blocked' | 'error'

export interface ImportOutcome { status: 'completed' | 'no-change'; added: FileRow[]; batchId: string | null }

export interface ImportState {
  phase: ImportPhase
  paths: string[]
  gameRoot: string | null
  candidates: string[]
  includeSettings: boolean
  preview: Preview | null
  /** Why planning stopped, when it is one the page explains with its own notice. */
  blocked: 'game-running' | 'recovery' | null
  progress: Progress | null
  outcome: ImportOutcome | null
  /** An add whose outcome is not known yet: never success, locked until `reconcile`. */
  unresolved: boolean
  error: Msg | null
  message: Msg | null
}

export const IDLE_IMPORT: ImportState = {
  phase: 'idle', paths: [], gameRoot: null, candidates: [], includeSettings: false, preview: null,
  blocked: null, progress: null, outcome: null, unresolved: false, error: null, message: null,
}

export type ImportBridge = Pick<InstallerBridge, 'discover' | 'locate' | 'pickFolder' | 'pickFiles' | 'planImport' | 'execute' | 'job' | 'reconcile'>

const SETTINGS = new Set(['ui', 'palette', 'primary'])
/** The rows that will change the game: everything the plan adds or replaces. */
export const addedRows = (preview: Preview | null): FileRow[] => preview?.rows.filter(r => r.action === 'create' || r.action === 'replace') ?? []
/** The rows Quick import does not add, each with its reason; personal settings left out are listed apart. */
export const skippedRows = (preview: Preview | null): FileRow[] => preview?.rows.filter(r => r.action === 'skip' && r.reason !== 'settings-not-included') ?? []
/** Personal settings files the drop carries, planned or not. */
export const settingsRows = (preview: Preview | null): FileRow[] => preview?.rows.filter(r => SETTINGS.has(r.category)) ?? []
/** The job's own outcome only; a running job publishes its progress until it ends. */
const TERMINAL = ['finished', 'failed', 'unknown', 'reconciled']
/** Codes that mean execute was refused before anything ran (as the restore page treats them). */
const REFUSALS = ['PLAN_MISSING', 'PLAN_STALE', 'INVALID_PACK', 'INVALID_PATH', 'BUSY', 'GAME_RUNNING', 'GAME_STATE_UNKNOWN', 'CONFLICT', 'UNOWNED_FILE', 'RECOVERY_REQUIRED', 'BACKUP_INVALID', 'UNSUPPORTED_PLATFORM']

export function createImportController(bridge: ImportBridge, storage: GameRootStorage, initial: ImportState = IDLE_IMPORT) {
  const store = createStore<ImportState>(initial)
  const { getState, publish } = store
  let sequence = 0
  let revision = 0
  let operationId: string | null = null
  const locked = () => { const { phase, unresolved } = getState(); return phase === 'adding' || unresolved }

  async function plan(keep: Msg | null = null): Promise<void> {
    const { gameRoot, paths, includeSettings } = getState()
    if (!gameRoot || !paths.length) return
    const mine = ++sequence
    publish({ phase: 'planning', blocked: null, error: keep, message: null, preview: null })
    try {
      const preview = await bridge.planImport({ gameRoot, paths, includeSettings, revision: ++revision })
      if (mine === sequence) publish({ phase: 'ready', preview, error: keep })
    } catch (error) {
      if (mine !== sequence) return
      const code = (error as { issue?: { code?: string } })?.issue?.code
      if (code === 'GAME_RUNNING') publish({ phase: 'blocked', blocked: 'game-running' })
      else if (code === 'RECOVERY_REQUIRED') publish({ phase: 'blocked', blocked: 'recovery' })
      else publish({ phase: 'error', error: errorMsg(error, { key: 'quick.error.plan' }) })
    }
  }

  /** A failed or refused add leaves no plan to run: show why, then plan the same choice again. */
  const replanAfter = (error: Msg) => plan(error)

  async function locateThenPlan(): Promise<void> {
    if (getState().gameRoot) return plan()
    const mine = ++sequence
    publish({ phase: 'locating', error: null })
    try {
      const { gameRoot, candidates } = await resolveGameRoot(bridge, storage)
      if (mine !== sequence) return
      if (gameRoot === null) { publish({ phase: 'needs-location', candidates }); return }
      publish({ gameRoot, candidates })
      await plan()
    } catch (error) {
      if (mine === sequence) publish({ phase: 'error', error: errorMsg(error, { key: 'quick.error.locate' }) })
    }
  }

  async function waitForJob(id: string) {
    let job = await bridge.job(id)
    while (!TERMINAL.includes(job.state)) {
      publish({ progress: job.progress })
      await new Promise(resolve => setTimeout(resolve, 250))
      job = await bridge.job(id)
    }
    return job
  }

  return {
    ...store,
    /** New paths from a drop or a picker: a new choice, planned from scratch. */
    async choose(paths: string[]): Promise<void> {
      if (locked() || !paths.length) return
      publish({ ...IDLE_IMPORT, gameRoot: getState().gameRoot, candidates: getState().candidates, phase: 'locating', paths })
      await locateThenPlan()
    },
    async pick(kind: 'files' | 'folder', lang: Lang): Promise<void> {
      if (locked()) return
      try {
        const picked = kind === 'files' ? await bridge.pickFiles('import', lang) : await bridge.pickFolder('import', lang).then(p => p === null ? null : [p])
        if (picked?.length) await this.choose(picked)
      } catch (error) { publish({ error: errorMsg(error, { key: 'quick.error.pick' }) }) }
    },
    /** The Advanced switch; the plan follows it, so the summary always shows what will happen. */
    async setIncludeSettings(includeSettings: boolean): Promise<void> {
      if (locked() || includeSettings === getState().includeSettings) return
      publish({ includeSettings })
      await plan()
    },
    async chooseGameRoot(root: string): Promise<void> {
      if (locked()) return
      const mine = ++sequence
      publish({ phase: 'locating', error: null })
      try {
        const located = await bridge.locate(root)
        if (mine !== sequence) return
        writeGameRoot(storage, located.gameRoot)
        publish({ gameRoot: located.gameRoot })
        await plan()
      } catch (error) { if (mine === sequence) publish({ phase: 'needs-location', error: errorMsg(error, { key: 'quick.error.locate' }) }) }
    },
    async chooseGameFolder(lang: Lang): Promise<void> {
      try { const root = await bridge.pickFolder('game', lang); if (root) await this.chooseGameRoot(root) }
      catch (error) { publish({ error: errorMsg(error, { key: 'quick.error.pick' }) }) }
    },
    /** Plans again with the same choice: after the game was closed, or a stale plan. */
    recheck: (): Promise<void> => locked() ? Promise.resolve() : locateThenPlan(),
    /** Runs the reviewed plan once. Nothing is sent when the plan adds nothing. */
    async add(): Promise<void> {
      const { phase, preview } = getState()
      if (phase !== 'ready' || !preview || addedRows(preview).length === 0) return
      const id = crypto.randomUUID()
      operationId = id
      publish({ phase: 'adding', progress: null, error: null, message: null })
      try {
        await bridge.execute({ operationId: id, planId: preview.planId, confirmation: 'install', allowConflicts: false })
      } catch (error) {
        const code = (error as { issue?: { code?: string } })?.issue?.code ?? ''
        if (!REFUSALS.includes(code)) {
          // The worker may have taken the plan before failing to answer: never success, locked.
          publish({ phase: 'done', unresolved: true, progress: null, error: { key: 'quick.error.unresolved' } })
          return
        }
        // Refused before anything ran. The engine may have used up the plan, so plan again.
        operationId = null
        await replanAfter(errorMsg(error, { key: 'quick.error.add' }))
        return
      }
      let job
      try { job = await waitForJob(id) } catch {
        // The add was accepted and its outcome could not be read: locked until reconciled.
        publish({ phase: 'done', unresolved: true, progress: null, error: { key: 'quick.error.unresolved' } })
        return
      }
      if (job.state === 'unknown') { publish({ phase: 'done', unresolved: true, progress: null, error: { key: 'quick.error.unresolved' } }); return }
      operationId = null
      if (job.state === 'failed') { await replanAfter(errorMsg(job.error, { key: 'quick.error.add' })); return }
      const status = job.result?.status
      if (status === 'completed' || status === 'no-change') {
        publish({ phase: 'done', progress: null, outcome: { status, added: addedRows(preview), batchId: job.result?.batchId ?? null } })
        return
      }
      publish({ phase: 'done', progress: null, error: incompleteMsg('quick.error.incomplete', status) })
    },
    async reconcile(): Promise<void> {
      if (!operationId) { publish({ unresolved: false }); return }
      try {
        await bridge.reconcile(operationId)
        operationId = null
        publish({ unresolved: false, error: null, message: { key: 'quick.reconciled' } })
      } catch (error) { publish({ error: errorMsg(error, { key: 'quick.error.reconcile' }) }) }
    },
    /** Back to Explore's cards. The game folder found is kept. */
    reset(): void {
      if (locked()) return
      sequence++
      publish({ ...IDLE_IMPORT, gameRoot: getState().gameRoot, candidates: getState().candidates })
    },
  }
}
export type ImportController = ReturnType<typeof createImportController>
