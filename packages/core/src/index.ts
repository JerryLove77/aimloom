// Browser-safe entry, shared by the App and the site: theme decoding and parsing, the scheme
// document and its offline SVG preview. Nothing here touches a file system or the game.
export type { Encoding, JsonValue, Rgba, SkyAppearance, Surface, Theme, ThemeSource, Vec3 } from "./types.js"
export { LocalizedError } from "./types.js"
export { decodeText, detectEncoding } from "./theme/decode.js"
export { parseTheme, type ParseResult } from "./theme/parse.js"
export type { SchemeDocument, SchemeEnvironment, SurfaceSlot } from "./scheme/types.js"
export { parseScheme, serializeScheme, validateScheme } from "./scheme/document.js"
export { renderSchemePreview } from "./scheme/preview.js"
