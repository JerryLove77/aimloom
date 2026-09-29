import type { EnemyList, EnemyShape, EnemySkin, EnemySkinChoice } from '../bridge/contracts'
import { browserStorage, type MessageKey } from '../i18n'
import type { GameRootStorage } from '../section/game-root'
import { createSection, IDLE_SECTION, type SectionBridge, type SectionPhase, type SectionState } from '../section/controller'

/** The subset of the installer bridge that the Enemy page needs. */
export interface EnemyBridge extends SectionBridge {
  enemyList(gameRoot: string): Promise<EnemyList>
  planEnemy(input: { gameRoot: string; shape: EnemyShape; model: string; skin: string; revision: number }): Promise<{ planId: string }>
}

export type EnemyPhase = SectionPhase

/** The game's own Skin Browser tab order: humanoid, cube, sphere. */
export const ENEMY_SHAPES: EnemyShape[] = ['cylindrical', 'cuboid', 'spheroid']
/** The tab label key for each shape; shared by the page (tabs) and this controller (messages). */
export const ENEMY_SHAPE_KEYS: Record<EnemyShape, MessageKey> = {
  cylindrical: 'enemy.shape.cylindrical', cuboid: 'enemy.shape.cuboid', spheroid: 'enemy.shape.spheroid',
}

export interface EnemyState extends SectionState {
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
}

const sameChoice = (a: EnemySkinChoice | null, b: EnemySkinChoice | null): boolean =>
  a === b || (a !== null && b !== null && a.model === b.model && a.skin === b.skin)

/**
 * Owns the Enemy page's current-configuration state. It changes only what the game's own
 * Skin Browser changes: the equipped {model, skin} pair for one shape.
 */
export function createEnemyController(bridge: EnemyBridge, storage: GameRootStorage = browserStorage()) {
  const section = createSection<EnemyState>(bridge, storage, {
    initial: { ...IDLE_SECTION, shape: 'cylindrical', current: { cylindrical: null, cuboid: null, spheroid: null }, skins: [], selected: {} },
    keys: {
      locate: 'enemy.error.locate', readDirectory: 'enemy.error.readDirectory', chooseFolder: 'enemy.error.chooseFolder',
      list: 'enemy.error.list', reconciled: 'enemy.applied.reconciled', reconcileFailed: 'enemy.error.reconcileFailed',
    },
    async list(gameRoot) {
      const listing = await bridge.enemyList(gameRoot)
      return { current: listing.current, skins: listing.skins }
    },
  })
  const { getState, publish } = section
  /** The picks without `shape`'s entry. */
  const without = (shape: EnemyShape) => {
    const selected = { ...getState().selected }
    delete selected[shape]
    return selected
  }
  return {
    getState,
    subscribe: section.subscribe,
    load: section.load,
    chooseGameRoot: section.chooseGameRoot,
    chooseFolder: section.chooseFolder,
    /** Switches the shape tab. Each shape's pending pick survives the switch (decision B). */
    selectShape(shape: EnemyShape): void {
      const state = getState()
      if (state.applying || shape === state.shape) return
      publish({ shape, error: null, message: null })
    },
    /** Picks a skin for the active shape. A pick equal to what is already equipped is not kept
     * as a pending entry, so Apply stays disabled without a separate "does it differ" check. */
    open(skin: EnemySkin): void {
      const state = getState()
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
      const state = getState()
      if (state.applying || state.selected[state.shape] === undefined) return
      publish({ selected: without(state.shape), error: null })
    },
    /** Shapes that currently hold a pending pick, in the game's tab order. */
    pendingShapes(): EnemyShape[] { return ENEMY_SHAPES.filter(shape => getState().selected[shape] !== undefined) },
    async apply(): Promise<boolean> {
      const { shape, selected, current, gameRoot, applying, unresolved } = getState()
      const pending = selected[shape]
      if (!pending || !gameRoot || applying || unresolved) return false
      if (sameChoice(pending, current[shape])) return false
      return section.apply({
        plan: revision => bridge.planEnemy({ gameRoot, shape, model: pending.model, skin: pending.skin, revision }),
        keys: { unresolved: 'enemy.error.unresolved', failed: 'enemy.error.applyFailed', incomplete: 'enemy.error.incomplete', failedGeneric: 'enemy.error.applyFailedGeneric' },
        done: status => ({ selected: without(shape), message: { key: status === 'completed' ? 'enemy.applied.success' : 'enemy.applied.noChange' } }),
      })
    },
    reconcile: section.reconcile,
  }
}

export type EnemyController = ReturnType<typeof createEnemyController>
