/**
 * Bilingual labels for the tuner's dynamic controls (id -> {zh, en}), kept word-for-word equal
 * to the App's `crosshair.tune.*` dictionary keys in `packages/app/src/i18n/{zh,en}.ts`, so the
 * website tool and the App tuner never diverge in what a control is called. This lives outside
 * the site's own `src/i18n` because it labels `@kvk/crosshair` parameter ids, not site copy, and
 * the client-side island (built with no framework) needs it as a plain runtime table rather than
 * Astro's server-side `t()`.
 */
import { CS2_PALETTE, VALORANT_PALETTE, type PaletteColor } from '../../../crosshair/src/palette'
import type { TuneValue } from '../../../crosshair/src/tuning'

export interface Bilingual { zh: string; en: string }

export const TUNE_HEADING: Bilingual = { zh: '微调', en: 'Fine-tune' }
export const TUNE_RESET: Bilingual = { zh: '恢复成粘贴的代码', en: 'Reset to the pasted code' }
export const TUNE_DARK: Bilingual = { zh: '深色底', en: 'Dark' }
export const TUNE_LIGHT: Bilingual = { zh: '浅色底', en: 'Light' }
export const TUNE_CUSTOM_SWATCH: Bilingual = { zh: '自定义', en: 'Custom' }
export const TUNE_CUSTOM_COLOR_PICKER: Bilingual = { zh: '自定义颜色', en: 'Custom color' }
export const TUNE_CUSTOM_ALPHA: Bilingual = { zh: '自定义颜色透明度', en: 'Custom color alpha' }

export const CS2_LABELS: Record<string, Bilingual> = {
  length: { zh: '长度', en: 'Length' },
  thickness: { zh: '粗细', en: 'Thickness' },
  gap: { zh: '间隙', en: 'Gap' },
  outlineEnabled: { zh: '描边', en: 'Outline' },
  outline: { zh: '描边宽度', en: 'Outline thickness' },
  alphaEnabled: { zh: '透明度', en: 'Alpha' },
  alpha: { zh: '透明度数值', en: 'Alpha value' },
  color: { zh: '颜色', en: 'Color' },
  centerDotEnabled: { zh: '中心点', en: 'Center dot' },
  tStyleEnabled: { zh: 'T 型准星', en: 'T-style' },
}

export const VALORANT_LABELS: Record<string, Bilingual> = {
  color: { zh: '颜色', en: 'Color' },
  outlines: { zh: '描边', en: 'Outlines' },
  outlineThickness: { zh: '描边宽度', en: 'Outline thickness' },
  outlineOpacity: { zh: '描边不透明度', en: 'Outline opacity' },
  centerDot: { zh: '中心点', en: 'Center dot' },
  dotThickness: { zh: '中心点粗细', en: 'Center dot thickness' },
  dotOpacity: { zh: '中心点不透明度', en: 'Center dot opacity' },
  'inner.enabled': { zh: '内线', en: 'Inner lines' },
  'inner.opacity': { zh: '内线不透明度', en: 'Inner opacity' },
  'inner.length': { zh: '内线长度', en: 'Inner length' },
  'inner.thickness': { zh: '内线粗细', en: 'Inner thickness' },
  'inner.offset': { zh: '内线间隙', en: 'Inner offset' },
  'outer.enabled': { zh: '外线', en: 'Outer lines' },
  'outer.opacity': { zh: '外线不透明度', en: 'Outer opacity' },
  'outer.length': { zh: '外线长度', en: 'Outer length' },
  'outer.thickness': { zh: '外线粗细', en: 'Outer thickness' },
  'outer.offset': { zh: '外线间隙', en: 'Outer offset' },
}

export function tuneLabel(game: 'cs2' | 'valorant', id: string, lang: 'zh' | 'en'): string {
  const table = game === 'cs2' ? CS2_LABELS : VALORANT_LABELS
  const entry = table[id]
  return entry ? entry[lang] : id
}

/** Same rule as `packages/app/src/crosshair/CodeExportDialog.tsx`'s `PALETTE_OWNED_IDS`: these
 * ids are drawn inside the custom-colour control, never as their own row. */
export const PALETTE_OWNED_IDS: Record<'cs2' | 'valorant', readonly string[]> = {
  cs2: ['red', 'green', 'blue'],
  valorant: ['customColor', 'useCustomColor'],
}

/** Same rule as the App's `dependencyDisabled`: a value survives while its parent switch is off,
 * but is not editable. */
export function dependencyDisabled(game: 'cs2' | 'valorant', id: string, values: Record<string, unknown>): boolean {
  if (game === 'cs2') {
    if (id === 'outline') return values.outlineEnabled !== true
    if (id === 'alpha') return values.alphaEnabled !== true
    return false
  }
  if (id === 'outlineThickness' || id === 'outlineOpacity') return values.outlines !== true
  if (id === 'dotThickness' || id === 'dotOpacity') return values.centerDot !== true
  if (id.startsWith('inner.') && id !== 'inner.enabled') return values['inner.enabled'] !== true
  if (id.startsWith('outer.') && id !== 'outer.enabled') return values['outer.enabled'] !== true
  return false
}

export interface PaletteSwatch { index: number; rgb: readonly [number, number, number]; name: string; checked: boolean }
export interface PaletteState { label: string; swatches: PaletteSwatch[]; custom: { name: string; checked: boolean } }

/**
 * The palette control's data, with no DOM: one entry per preset colour (name in the page's
 * language, whether it is the selected one) plus the trailing "custom" entry — pure so it can be
 * unit-tested directly. `src/scripts/crosshair-tool.client.ts` renders this as a `role="radiogroup"`
 * of round swatch buttons, one per entry, matching `PaletteControl` in the App's
 * `CodeExportDialog.tsx`.
 */
export function paletteState(game: 'cs2' | 'valorant', values: Record<string, TuneValue>, lang: 'zh' | 'en'): PaletteState {
  const palette: readonly PaletteColor[] = game === 'cs2' ? CS2_PALETTE : VALORANT_PALETTE
  const colorIndex = typeof values.color === 'number' ? values.color : 0
  const isCustom = game === 'cs2' ? colorIndex >= palette.length : values.useCustomColor === true
  return {
    label: tuneLabel(game, 'color', lang),
    swatches: palette.map((entry, index) => ({
      index, rgb: entry.rgb, name: lang === 'zh' ? entry.nameZh : entry.nameEn,
      checked: !isCustom && colorIndex === index,
    })),
    custom: { name: TUNE_CUSTOM_SWATCH[lang], checked: isCustom },
  }
}
