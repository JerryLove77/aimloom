import type { ExecuteRequest, Job, Preview } from '../installer/contracts'
import { browserStorage } from '../i18n'
import { resolveGameRoot, writeGameRoot, type GameRootStorage, type LocateBridge } from '../workspace/game-root'
import { errorMsg } from '../workspace/issue-text'
import { t, type Lang, type Msg } from '../i18n'
import type { TrainingProfile } from './model'

/** The subset of the installer bridge the apply dialog needs. */
export interface ApplyBridge extends LocateBridge {
  pickFolder(kind: 'game', lang: Lang): Promise<string | null>
  planProfileApply(input: { gameRoot: string; id: string; revision: number }): Promise<Preview>
  execute(input: ExecuteRequest): Promise<Job>
  job(operationId: string): Promise<Job>
  reconcile(operationId: string): Promise<unknown>
  /** Best effort; a rejection here must never turn a successful apply into a failure. */
  launchGame(): Promise<void>
}

export type ApplyPhase = 'idle' | 'locating' | 'needs-location' | 'planning' | 'ready' | 'applying' | 'unresolved'
export type ApplyOutcome = 'completed' | 'no-change' | 'failed' | 'unresolved'

export interface ApplyState {
  phase: ApplyPhase
  /** The saved Profile being applied -- never an open editor's draft. */
  profile: TrainingProfile | null
  gameRoot: string | null
  candidates: string[]
  /** True once a plan resolved successfully; the dialog hides its confirm button otherwise. */
  canConfirm: boolean
  error: Msg | null
}

/** A status code the engine returns, or none. Mirrors the Scheme controller's own helper. */
function incompleteMsg(status: string | undefined): Msg {
  if (status !== undefined) return { key: 'profile.apply.error.incomplete', params: { status } }
  return {
    zh: t('zh', 'profile.apply.error.incomplete', { status: t('zh', 'common.unknownStatus') }),
    en: t('en', 'profile.apply.error.incomplete', { status: t('en', 'common.unknownStatus') }),
  }
}

/**
 * Owns applying one saved Profile to the game: locate -> plan -> confirm -> execute -> job ->
 * unknown/reconcile, the same shape every current-configuration section already uses. Nothing
 * here reads or writes an editor draft; `open` always takes the saved Profile record.
 */
export function createApplyController(bridge: ApplyBridge, storage: GameRootStorage = browserStorage()) {
  let state: ApplyState = { phase: 'idle', profile: null, gameRoot: null, candidates: [], canConfirm: false, error: null }
  const listeners = new Set<() => void>()
  let session = 0
  let revision = 0
  let planId: string | null = null
  let operationId: string | null = null
  const publish = (patch: Partial<ApplyState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  const terminal = (jobState: string) => ['finished', 'failed', 'unknown', 'reconciled'].includes(jobState)
  const idle = (): ApplyState => ({ phase: 'idle', profile: null, gameRoot: null, candidates: [], canConfirm: false, error: null })

  async function plan(gameRoot: string, mine: number): Promise<void> {
    publish({ phase: 'planning', gameRoot, error: null })
    try {
      const preview = await bridge.planProfileApply({ gameRoot, id: state.profile!.id, revision: ++revision })
      if (mine !== session) return
      planId = preview.planId
      publish({ phase: 'ready', canConfirm: true, error: null })
    } catch (error) {
      if (mine !== session) return
      planId = null
      publish({ phase: 'ready', canConfirm: false, error: errorMsg(error, { key: 'profile.apply.error.plan' }) })
    }
  }

  /**
   * The worker spends a plan on every execute, successful or not, so after a failure the old
   * planId can never run again. Re-plan at once: if the Profile still resolves, Confirm works on
   * the fresh plan and the failure stays visible; if it no longer does (a file changed or went
   * missing), the refusal the new plan gives replaces it.
   */
  async function replanAfter(failure: ApplyState['error'], mine: number): Promise<void> {
    planId = null
    const gameRoot = state.gameRoot
    if (gameRoot === null) { publish({ phase: 'ready', canConfirm: false, error: failure }); return }
    await plan(gameRoot, mine)
    if (mine === session && state.canConfirm) publish({ error: failure })
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    /** Opens the dialog for `profile` (the saved record) and starts resolving the game folder. */
    async open(profile: TrainingProfile): Promise<void> {
      const mine = ++session
      planId = null
      publish({ phase: 'locating', profile, gameRoot: null, candidates: [], canConfirm: false, error: null })
      try {
        const { gameRoot, candidates } = await resolveGameRoot(bridge, storage)
        if (mine !== session) return
        if (gameRoot === null) { publish({ phase: 'needs-location', candidates }); return }
        await plan(gameRoot, mine)
      } catch (error) {
        if (mine === session) publish({ phase: 'ready', error: errorMsg(error, { key: 'profile.apply.error.locate' }) })
      }
    },
    async chooseGameRoot(root: string): Promise<void> {
      const mine = session
      publish({ phase: 'planning', error: null })
      try {
        const located = await bridge.locate(root)
        if (mine !== session) return
        writeGameRoot(storage, located.gameRoot)
        await plan(located.gameRoot, mine)
      } catch (error) {
        if (mine === session) publish({ phase: 'needs-location', error: errorMsg(error, { key: 'profile.apply.error.chooseFolder' }) })
      }
    },
    async chooseFolder(lang: Lang): Promise<void> {
      try {
        const root = await bridge.pickFolder('game', lang)
        if (!root) return
        await this.chooseGameRoot(root)
      } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'profile.apply.error.chooseFolder' }) }) }
    },
    /**
     * Executes the previewed plan. Returns the outcome so the caller can raise a library-wide
     * notice; on a completed/no-change result the dialog resets to `idle` on its own.
     *
     * `launch` asks that, once (and only once) the apply itself finished with `completed` or
     * `no-change`, the game is started too. Launching is best effort: a rejection from
     * `bridge.launchGame()` is swallowed here and never changes the returned outcome -- a
     * successful apply stays successful whether or not the game actually started.
     */
    async confirm(launch = false): Promise<ApplyOutcome> {
      if (state.phase !== 'ready' || !planId || !state.profile) return 'failed'
      const mine = session
      const id = crypto.randomUUID()
      operationId = id
      publish({ phase: 'applying', error: null })
      try {
        await bridge.execute({ operationId: id, planId, confirmation: 'install', allowConflicts: false })
        let job = await bridge.job(id)
        for (let attempt = 0; !terminal(job.state) && attempt < 240; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250))
          job = await bridge.job(id)
        }
        if (mine !== session) return 'failed'
        if (job.state === 'unknown') {
          publish({ phase: 'unresolved', error: { key: 'profile.apply.error.unresolved' } })
          return 'unresolved'
        }
        if (job.state === 'failed') {
          await replanAfter(errorMsg(job.error, { key: 'profile.apply.error.failed' }), mine)
          return 'failed'
        }
        const status = job.result?.status
        if (status === 'completed' || status === 'no-change') {
          operationId = null
          planId = null
          publish(idle())
          if (launch) { try { await bridge.launchGame() } catch { /* best effort: never turns a successful apply into a failure */ } }
          return status
        }
        await replanAfter(incompleteMsg(status), mine)
        return 'failed'
      } catch (error) {
        if (mine === session) await replanAfter(errorMsg(error, { key: 'profile.apply.error.failed' }), mine)
        return 'failed'
      }
    },
    async reconcile(): Promise<boolean> {
      if (!operationId) { publish(idle()); return true }
      try {
        await bridge.reconcile(operationId)
        operationId = null
        planId = null
        publish(idle())
        return true
      } catch (error) { publish({ error: errorMsg(error, { key: 'profile.apply.error.reconcileFailed' }) }); return false }
    },
    /** Cancel/Esc: never allowed to interrupt a running execute or an unresolved outcome. */
    close(): void {
      if (state.phase === 'applying' || state.phase === 'unresolved') return
      session++
      planId = null
      publish(idle())
    },
  }
}

export type ApplyController = ReturnType<typeof createApplyController>
