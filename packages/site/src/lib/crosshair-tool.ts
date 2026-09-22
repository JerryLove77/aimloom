/**
 * Pure logic for the website's crosshair tool (WEB-CROSSHAIR): paste a CS2/VALORANT code, tune
 * it and encode a PNG — entirely in the browser, nothing uploaded. This module holds only pure
 * functions (parse -> render -> encode, and the bilingual text for errors/warnings) so it can be
 * unit-tested with plain input/output, with no DOM. `src/scripts/crosshair-tool.client.ts` wires
 * these functions to the page's controls.
 *
 * Reuses `@kvk/crosshair`'s browser-safe entry only (`src/index.ts`/`src/png.ts`) — never
 * `src/node.ts`, which depends on Node's `Buffer`/`zlib` and does not run in a visitor's browser.
 * The relative import depth mirrors `packages/app/src/crosshair/export-controller.ts`, which
 * resolves the same package the same way.
 */
import {
  parseCrosshair, renderCrosshair, toSvg, getTuningParams, readTuningValue, tune,
  CrosshairError, type CrosshairGame, type CrosshairWarning, type ParsedCrosshair,
  type TuneChanges, type TuneValue, type TuningParam,
} from '../../../crosshair/src/index'
import { canonicalPngIssue, encodePng } from '../../../crosshair/src/png'

export type { CrosshairGame, ParsedCrosshair, TuneValue, TuningParam, CrosshairWarning }
export { getTuningParams, readTuningValue, tune, CrosshairError }

export interface CrosshairPreview {
  game: CrosshairGame
  svg: string
  width: number
  height: number
  png: Uint8Array
  warnings: CrosshairWarning[]
}

/** Renders a parsed crosshair to SVG (for the swatches) and a canonical PNG (for the download). */
export function renderPreview(parsed: ParsedCrosshair): CrosshairPreview {
  const raster = renderCrosshair(parsed)
  const png = encodePng({ width: raster.width, height: raster.height, data: raster.data, warnings: [] })
  const issue = canonicalPngIssue(png)
  if (issue) throw new CrosshairError('INVALID_PNG', issue.zh, issue.en)
  return { game: parsed.game, svg: toSvg(raster), width: raster.width, height: raster.height, png, warnings: raster.warnings }
}

/** Parses a pasted code and renders it. Throws `CrosshairError` (bilingual) on a bad code. */
export function previewFromCode(code: string): { parsed: ParsedCrosshair; preview: CrosshairPreview } {
  const parsed = parseCrosshair(code)
  return { parsed, preview: renderPreview(parsed) }
}

/** Returns a NEW parsed crosshair with `changes` applied, and its render. `parsed` is untouched. */
export function previewWithTune(parsed: ParsedCrosshair, changes: TuneChanges): { parsed: ParsedCrosshair; preview: CrosshairPreview } {
  const next = tune(parsed, changes)
  return { parsed: next, preview: renderPreview(next) }
}

/** Every control's current value, for seeding the tuner. */
export function readAllValues(parsed: ParsedCrosshair, params: TuningParam[]): Record<string, TuneValue> {
  const values: Record<string, TuneValue> = {}
  for (const param of params) values[param.id] = readTuningValue(parsed, param.id)
  return values
}

/** `aimloom-cs2-crosshair.png` / `aimloom-valorant-crosshair.png`. */
export function downloadFileName(game: CrosshairGame): string {
  return `aimloom-${game}-crosshair.png`
}

/** Bilingual text for a thrown error. A `CrosshairError` already carries both; anything else
 * (a caller bug, not a bad code) falls back to a generic bilingual message. */
export function errorText(error: unknown, lang: 'zh' | 'en'): string {
  if (error instanceof CrosshairError) return lang === 'zh' ? error.message : error.en
  return lang === 'zh' ? '发生未知错误，请重试。' : 'An unknown error occurred; please try again.'
}

/** Warnings from the package carry only a Chinese `message`, keyed by a stable `code`; this is
 * the English side, kept in step with the codes `render.ts`/`cs2.ts`/`valorant.ts` push. */
const WARNING_EN: Record<string, (zh: string) => string> = {
  STATIC_APPROXIMATION: () =>
    "This preview uses Aimloom's own static approximate geometry and preset colors; it is not guaranteed to match the game pixel-for-pixel.",
  EMPTY_CROSSHAIR: () =>
    'The current settings produce a fully transparent crosshair; check the lines, center dot and opacity.',
  CS2_DISABLED_STYLE: zh => {
    const style = zh.match(/\d+/)?.[0] ?? ''
    return `Style ${style} is a legacy CS2 style that is now disabled; the static image cannot reproduce its original in-game behavior.`
  },
  CS2_DYNAMIC_STYLE: () =>
    'This crosshair uses a dynamic style; the static image does not include movement, firing or line-split effects.',
  CS2_FOLLOW_RECOIL: () =>
    'This code enables recoil-following; the static image does not follow weapon recoil.',
  CS2_WEAPON_GAP: () =>
    'This code enables per-weapon gap adjustment; the static image cannot change the gap by weapon.',
  VALORANT_DYNAMIC_STATIC: () =>
    'This crosshair enables movement or firing error; the result is a static image and cannot reproduce the in-game dynamic changes.',
  VALORANT_SNIPER_NOT_RENDERED: () =>
    'Sniper scope settings were read and validated; this version does not render the sniper crosshair yet.',
  VALORANT_ADS_USES_PRIMARY: () =>
    'A separate ADS setting was kept; the current code enables copying the primary crosshair, so the ADS preview uses the primary crosshair.',
  VALORANT_ADS_DEFAULT: () =>
    'The current code disables ADS copying and provides no ADS section; ADS will use the default settings.',
}

export function warningText(warning: CrosshairWarning, lang: 'zh' | 'en'): string {
  if (lang === 'zh') return warning.message
  const en = WARNING_EN[warning.code]
  return en ? en(warning.message) : warning.message
}
