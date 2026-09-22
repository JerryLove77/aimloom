// Browser-safe entry: no Node, filesystem, provider calls or game writes.
export { parseEnemyColor, parseEnemyDocument, serializeEnemyDocument, validateEnemySelection, resolveEnemyAppearance } from "./model.js"
export type { EnemySelection, EnemyDocument, EnemySource, EnemyField } from "./model.js"
export { ENEMY_BINDINGS, ENEMY_KEYS, enemyToPatch, readEnemyAppearance, composeSchemeEnemyPatch, prepareEnemyReplacement } from "./settings.js"
export type { EnemyChange } from "./settings.js"
export { createEnemyPreview, renderEnemySvg, enemyColorToHex } from "./preview.js"
export type { EnemyPreviewState, EnemyPreview } from "./preview.js"
