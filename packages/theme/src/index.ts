// Browser-safe entry, shared by the App and the site: theme decoding and parsing, the theme
// document and its offline SVG preview. Nothing here touches a file system or the game.
export type { Encoding, JsonValue, Rgba, SkyAppearance, Surface, Theme, ThemeSource, Vec3 } from "./types.js"
export { LocalizedError } from "./types.js"
export { decodeText, detectEncoding } from "./theme/decode.js"
export { parseTheme, type ParseResult } from "./theme/parse.js"
export type { ThemeDocument, ThemeEnvironment, SurfaceSlot } from "./theme/types.js"
export { parseThemeDocument, serializeThemeDocument, validateThemeDocument } from "./theme/document.js"
export { renderThemePreview } from "./theme/preview.js"
