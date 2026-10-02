import type { Lang, MessageKey, Msg } from '../i18n'
import { errorMsg } from './issue-text'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from './game-root'
import { incompleteMsg, waitForJob, type PlanJob, type PlanRunner } from './run-plan'

/** A page controller's state and who listens to it. */
export function createStore<S>(initial: S) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    publish(patch: Partial<S>) {
      state = { ...state, ...patch }
      listeners.forEach(listener => listener())
    },
  }
}

export type SectionPhase = 'idle' | 'locating' | 'needs-location' | 'loading' | 'ready' | 'error'

/** What every game-side section (Theme, Sounds, Crosshair, Enemy) holds besides its own data. */
export interface SectionState {
  phase: SectionPhase
  gameRoot: string | null
  candidates: string[]
  applying: boolean
  /** An operation whose outcome is not yet known; the page stays locked until reconciliation. */
  unresolved: boolean
  message: Msg | null
  error: Msg | null
}

export const IDLE_SECTION: SectionState = {
  phase: 'idle', gameRoot: null, candidates: [], applying: false, unresolved: false, message: null, error: null,
}

/** The bridge calls every section makes to find the game and carry out a plan. */
export interface SectionBridge extends PlanRunner {
  discover(): Promise<{ candidates: string[] }>
  locate(gameRoot: string): Promise<{ gameRoot: string }>
  pickFolder(kind: 'game', lang: Lang): Promise<string | null>
  reconcile(operationId: string): Promise<{ job: PlanJob }>
}

/** Each section's own wording for the shared steps. */
export interface SectionKeys {
  locate: MessageKey
  readDirectory: MessageKey
  chooseFolder: MessageKey
  list: MessageKey
  reconciled: MessageKey
  reconcileFailed: MessageKey
}

/** One apply: the plan to make and the section's wording and result for each outcome. */
export interface SectionApply<S> {
  plan(revision: number): Promise<{ planId: string }>
  keys: { unresolved: MessageKey; failed: MessageKey; incomplete: MessageKey; failedGeneric: MessageKey }
  /** The state after a completed or no-change apply, once the listing has been refreshed. */
  done(status: 'completed' | 'no-change'): Partial<S>
}

/**
 * The part of a section controller that is the same for Theme, Sounds, Crosshair and Enemy:
 * finding the game folder, listing, applying one plan and reconciling an unknown result.
 * The section keeps its own data and actions and says in `list` what a listing puts in state.
 */
export function createSection<S extends SectionState>(bridge: SectionBridge, storage: GameRootStorage, options: {
  initial: S
  keys: SectionKeys
  list(gameRoot: string): Promise<Partial<S>>
  /** Extra state cleared when a load starts. */
  onLoad?: Partial<S>
  /** Extra state cleared after a successful reconcile. */
  onReconciled?: Partial<S>
}) {
  const store = createStore(options.initial)
  const { getState, publish } = store
  const { keys } = options
  let revision = 0
  let operationId: string | null = null
  async function list(gameRoot: string): Promise<void> {
    publish({ phase: 'ready', gameRoot, ...await options.list(gameRoot) } as Partial<S>)
  }
  async function refresh(): Promise<void> {
    const gameRoot = getState().gameRoot
    if (!gameRoot) return
    try { await list(gameRoot) } catch (error) { publish({ error: errorMsg(error, { key: keys.list }) } as Partial<S>) }
  }
  return {
    ...store,
    refresh,
    nextRevision: () => ++revision,
    /** Starts tracking a new operation and returns its id. */
    startOperation(): string { operationId = crypto.randomUUID(); return operationId },
    /** The operation's outcome is known: nothing is left to reconcile. */
    finishOperation(): void { operationId = null },
    async load(): Promise<void> {
      const state = getState()
      if (state.phase === 'locating' || state.applying) return
      publish({ phase: 'locating', error: null, message: null, ...options.onLoad } as Partial<S>)
      try {
        const { gameRoot, candidates } = await resolveGameRoot(bridge, storage)
        if (gameRoot === null) {
          publish({ phase: 'needs-location', candidates, gameRoot: null } as Partial<S>)
          return
        }
        publish({ phase: 'loading', candidates } as Partial<S>)
        await list(gameRoot)
      } catch (error) { publish({ phase: 'error', error: errorMsg(error, { key: keys.locate }) } as Partial<S>) }
    },
    async chooseGameRoot(root: string): Promise<void> {
      publish({ phase: 'loading', error: null, message: null } as Partial<S>)
      try { await list(root); writeGameRoot(storage, root) } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: keys.readDirectory }) } as Partial<S>) }
    },
    async chooseFolder(this: { chooseGameRoot(root: string): Promise<void> }, lang: Lang): Promise<void> {
      try {
        const root = await bridge.pickFolder('game', lang)
        if (root) await this.chooseGameRoot(root)
      } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: keys.chooseFolder }) } as Partial<S>) }
    },
    /** Plans, executes and waits; the page locks on an unknown result until `reconcile`. */
    async apply(run: SectionApply<S>): Promise<boolean> {
      publish({ applying: true, error: null, message: null } as Partial<S>)
      const id = crypto.randomUUID()
      operationId = id
      try {
        const preview = await run.plan(++revision)
        const job = await waitForJob(bridge, id, preview.planId)
        if (job.state === 'unknown') {
          publish({ applying: false, unresolved: true, error: { key: run.keys.unresolved } } as Partial<S>)
          return false
        }
        if (job.state === 'failed') {
          await refresh()
          publish({ applying: false, error: errorMsg(job.error, { key: run.keys.failed }) } as Partial<S>)
          return false
        }
        const status = job.result?.status
        if (status === 'no-change' || status === 'completed') {
          operationId = null
          await refresh()
          publish({ applying: false, ...run.done(status) } as Partial<S>)
          return true
        }
        await refresh()
        publish({ applying: false, error: incompleteMsg(run.keys.incomplete, status) } as Partial<S>)
        return false
      } catch (error) {
        await refresh()
        publish({ applying: false, error: errorMsg(error, { key: run.keys.failedGeneric }) } as Partial<S>)
        return false
      }
    },
    async reconcile(): Promise<void> {
      if (!operationId) { publish({ unresolved: false } as Partial<S>); return }
      try {
        const { job } = await bridge.reconcile(operationId)
        operationId = null
        await refresh()
        // A successful query can recover a failed write (or a failed backup scan).
        if (job.state === 'failed' || job.error) {
          publish({ unresolved: false, error: errorMsg(job.error, { key: keys.reconcileFailed }), message: null } as Partial<S>)
          return
        }
        publish({ unresolved: false, error: null, message: { key: keys.reconciled }, ...options.onReconciled } as Partial<S>)
      } catch (error) { publish({ error: errorMsg(error, { key: keys.reconcileFailed }) } as Partial<S>) }
    },
  }
}
