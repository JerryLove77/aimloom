// Browser-safe entry: intentionally does not export NodeAdapter, file stores or game writers.
export type { SchemeDocument, SchemeEnvironment, SchemeFileReader, SchemeSelection, SurfaceSlot } from "./types.js"
export { parseScheme, serializeScheme, validateScheme } from "./document.js"
export { replaceScheme, resolveScheme, validateSchemeSelection } from "./selection.js"
export { composeSchemeTheme, prepareSchemeReplacement, schemeToPatch } from "./replacement.js"
export type { SchemeBlocker, SchemeChange, SchemeReplacement } from "./replacement.js"
export { renderSchemePreview } from "./preview.js"
