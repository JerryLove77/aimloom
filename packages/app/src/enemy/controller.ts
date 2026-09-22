import type { EnemyList, EnemyShape, EnemySkin, EnemySkinChoice } from '../installer/contracts'
import { browserStorage } from '../i18n'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from '../workspace/game-root'
import { errorMsg } from '../workspace/issue-text'
import { t, type Lang, type MessageKey, type Msg } from '../i18n'

/** The subset of the installer bridge that the Enemy page needs. */
export interface EnemyBridge {
  discover(): Promise<{ candidates: string[] }>
  locate(gameRoot: string): Promise<{ gameRoot: string }>
  pickFolder(kind: 'game' | 'pack', lang: Lang): Promise<string | null>
  enemyList(gameRoot: string): Promise<EnemyList>
  planEnemy(input: { gameRoot: string; shape: EnemyShape; model: string; skin: string; revision: number }): Promise<{ planId: string }>
  execute(input: { operationId: string; planId: string; confirmation: 'install'; allowConflicts: boolean }): Promise<{ operationId: string }>
  job(operationId: string): Promise<{ state: string; result?: { status: string } | null; error?: { code: string; message: string; messageEn?: string } | null }>
  reconcile(operationId: string): Promise<unknown>
}

export type EnemyPhase = 'idle' | 'locating' | 'needs-location' | 'loading' | 'ready' | 'error'

/** The game's own Skin Browser tab order: humanoid, cube, sphere. */
export const ENEMY_SHAPES: EnemyShape[] = ['cylindrical', 'cuboid', 'spheroid']
/** The tab label key for each shape; shared by the page (tabs) and this controller (messages). */
export const ENEMY_SHAPE_KEYS: Record<EnemyShape, MessageKey> = {
  cylindrical: 'enemy.shape.cylindrical', cuboid: 'enemy.shape.cuboid', spheroid: 'enemy.shape.spheroid',
}

export interface EnemyState {
  phase: EnemyPhase
  gameRoot: string | null
  candidates: string[]
  /** The tab the page shows: the shape whose skins are listed. */
  shape: EnemyShape
  /** The equipped pair per shape, read from the settings file. */
  current: EnemyList['current']
  /** The fixed 15-row catalog, from the game's own Skin Browser. */
  skins: EnemySkin[]
  /** One unconfirmed pick per shape. Switching tabs keeps every shape's pick (decision B, same
   * rule as Audio's per-event drafts) — only shapes whose pick actually differs from the
   * equipped pair stay here, so Apply's enablement is just "this shape has an entry". */
  selected: Partial<Record<EnemyShape, EnemySkinChoice>>
  applying: boolean
  unresolved: boolean
  message: Msg | null
  error: Msg | null
}

/** A status code the engine returns, or none. A real code is language-neutral and sits in
 * either dictionary's template as-is; an absent one needs its own translated word, so this
 * builds the final bilingual pair directly instead of leaving `{status}` for later substitution. */
function incompleteMsg(status: string | undefined): Msg {
  if (status !== undefined) return { key: 'enemy.error.incomplete', params: { status } }
  return {
    zh: t('zh', 'enemy.error.incomplete', { status: t('zh', 'common.unknownStatus') }),
    en: t('en', 'enemy.error.incomplete', { status: t('en', 'common.unknownStatus') }),
  }
}

const sameChoice = (a: EnemySkinChoice | null, b: EnemySkinChoice | null): boolean =>
  a === b || (a !== null && b !== null && a.model === b.model && a.skin === b.skin)

/**
 * Owns the Enemy page's current-configuration state. It changes only what the game's own
 * Skin Browser changes: the equipped {model, skin} pair for one shape.
 */
export function createEnemyController(bridge: EnemyBridge, storage: GameRootStorage = browserStorage()) {
  let state: EnemyState = {
    phase: 'idle', gameRoot: null, candidates: [], shape: 'cylindrical', current: { cylindrical: null, cuboid: null, spheroid: null },
    skins: [], selected: {}, applying: false, unresolved: false, message: null, error: null,
  }
  const listeners = new Set<() => void>()
  let revision = 0
  let operationId: string | null = null
  const publish = (patch: Partial<EnemyState>) => {
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  async function list(gameRoot: string): Promise<void> {
    const listing = await bridge.enemyList(gameRoot)
    publish({ phase: 'ready', gameRoot, current: listing.current, skins: listing.skins })
  }
  async function refresh(): Promise<void> {
    if (!state.gameRoot) return
    try { await list(state.gameRoot) } catch (error) { publish({ error: errorMsg(error, { key: 'enemy.error.list' }) }) }
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
      } catch (error) { publish({ phase: 'error', error: errorMsg(error, { key: 'enemy.error.locate' }) }) }
    },
    async chooseGameRoot(root: string): Promise<void> {
      publish({ phase: 'loading', error: null, message: null })
      try { await list(root); writeGameRoot(storage, root) } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'enemy.error.readDirectory' }) }) }
    },
    async chooseFolder(lang: Lang): Promise<void> {
      try {
        const root = await bridge.pickFolder('game', lang)
        if (root) await this.chooseGameRoot(root)
      } catch (error) { publish({ phase: 'needs-location', error: errorMsg(error, { key: 'enemy.error.chooseFolder' }) }) }
    },
    /** Switches the shape tab. Each shape's pending pick survives the switch (decision B). */
    selectShape(shape: EnemyShape): void {
      if (state.applying || shape === state.shape) return
      publish({ shape, error: null, message: null })
    },
    /** Picks a skin for the active shape. A pick equal to what is already equipped is not kept
     * as a pending entry, so Apply stays disabled without a separate "does it differ" check. */
    open(skin: EnemySkin): void {
      if (state.unresolved || state.applying) return
      if (!skin.shapes.includes(state.shape)) return
      const choice: EnemySkinChoice = { model: skin.model, skin: skin.skin }
      const selected = { ...state.selected }
      if (sameChoice(choice, state.current[state.shape])) delete selected[state.shape]
      else selected[state.shape] = choice
      publish({ selected, error: null, message: null })
    },
    /** Discards only the active shape's pending pick. */
    close(): void {
      if (state.applying || state.selected[state.shape] === undefined) return
      const selected = { ...state.selected }
      delete selected[state.shape]
      publish({ selected, error: null })
    },
    /** Shapes that currently hold a pending pick, in the game's tab order. */
    pendingShapes(): EnemyShape[] { return ENEMY_SHAPES.filter(shape => state.selected[shape] !== undefined) },
    async apply(): Promise<boolean> {
      const shape = state.shape
      const pending = state.selected[shape]
      if (!pending || !state.gameRoot || state.applying || state.unresolved) return false
      if (sameChoice(pending, state.current[shape])) return false
      publish({ applying: true, error: null, message: null })
      const id = crypto.randomUUID()
      operationId = id
      try {
        const preview = await bridge.planEnemy({ gameRoot: state.gameRoot, shape, model: pending.model, skin: pending.skin, revision: ++revision })
        await bridge.execute({ operationId: id, planId: preview.planId, confirmation: 'install', allowConflicts: false })
        let job = await bridge.job(id)
        for (let attempt = 0; !['finished', 'failed', 'unknown', 'reconciled'].includes(job.state) && attempt < 240; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 250))
          job = await bridge.job(id)
        }
        if (job.state === 'unknown') {
          publish({ applying: false, unresolved: true, error: { key: 'enemy.error.unresolved' } })
          return false
        }
        if (job.state === 'failed') {
          await refresh()
          publish({ applying: false, error: errorMsg(job.error, { key: 'enemy.error.applyFailed' }) })
          return false
        }
        const status = job.result?.status
        if (status === 'no-change') {
          operationId = null
          const selected = { ...state.selected }
          delete selected[shape]
          await refresh()
          publish({ applying: false, selected, message: { key: 'enemy.applied.noChange' } })
          return true
        }
        if (status !== 'completed') {
          await refresh()
          publish({ applying: false, error: incompleteMsg(status) })
          return false
        }
        operationId = null
        const selected = { ...state.selected }
        delete selected[shape]
        await refresh()
        publish({ applying: false, selected, message: { key: 'enemy.applied.success' } })
        return true
      } catch (error) {
        await refresh()
        publish({ applying: false, error: errorMsg(error, { key: 'enemy.error.applyFailedGeneric' }) })
        return false
      }
    },
    async reconcile(): Promise<void> {
      if (!operationId) { publish({ unresolved: false }); return }
      try {
        await bridge.reconcile(operationId)
        operationId = null
        await refresh()
        publish({ unresolved: false, error: null, message: { key: 'enemy.applied.reconciled' } })
      } catch (error) { publish({ error: errorMsg(error, { key: 'enemy.error.reconcileFailed' }) }) }
    },
  }
}

export type EnemyController = ReturnType<typeof createEnemyController>
