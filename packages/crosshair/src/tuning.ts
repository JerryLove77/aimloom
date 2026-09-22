/**
 * The crosshair tuner (ROADMAP CUR-C2): the parameters Aimloom exposes as sliders/switches for
 * a pasted CS2 or VALORANT code, and a pure `tune` that returns a new parsed crosshair with
 * those parameters changed. `tune` never mutates its input, and its output always satisfies
 * `createScene`/`renderCrosshair` because every value is clamped and step-snapped into range
 * rather than rejected — the tuner is sliders, not a form that can show a validation error per
 * keystroke. A value of the wrong JS type (e.g. a string where a number is expected) is still
 * refused with a bilingual `CrosshairError`, because that can only be a caller bug, never a
 * slider position.
 *
 * CS2's ranges are Aimloom's own choice, not verified against the game's settings UI — the
 * wire format only records capacities (see the added paragraph in
 * docs/research/cs2-crosshair-sources.md). VALORANT's ranges are the documented field ranges
 * from docs/research/valorant-crosshair-sources.md.
 */
import { CrosshairError } from './errors';
import type { Cs2Crosshair, Cs2Settings } from './cs2';
import type { ParsedCrosshair } from './render-types';
import type { ValorantCrosshair, ValorantLine, ValorantProfile } from './valorant';
import type { CrosshairGame } from './index';

export type TuningParamKind = 'number' | 'boolean' | 'color' | 'palette';

export interface TuningParam {
  /** Dot-path id for a VALORANT line field (e.g. `inner.length`); a bare key otherwise. */
  id: string;
  kind: TuningParamKind;
  /** number/palette only. For palette, indices run min..max inclusive. */
  min?: number;
  max?: number;
  /** number/palette only. */
  step?: number;
  /** palette only: how many swatches the UI should draw (== max - min + 1). */
  paletteSize?: number;
}

export type TuneValue = number | boolean | string;
export type TuneChanges = Record<string, TuneValue>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupportedParam(id: string): CrosshairError {
  return new CrosshairError('UNSUPPORTED_FIELD', `未知的微调参数 ${id}。`, `Unknown tuning parameter ${id}.`, id);
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CrosshairError('INVALID_VALUE', `${field} 必须是数值。`, `${field} must be a number.`, field);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new CrosshairError('INVALID_VALUE', `${field} 必须是布尔值。`, `${field} must be a boolean.`, field);
  }
  return value;
}

function asColorHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9A-Fa-f]{8}$/.test(value)) {
    throw new CrosshairError('INVALID_VALUE', `${field} 必须是 8 位 RGBA 十六进制颜色。`, `${field} must be an 8-digit RGBA hex color.`, field);
  }
  return value.toUpperCase();
}

/** Clamps into [min, max], then snaps to the nearest step from min, cleaning float drift. */
function clampStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const steps = Math.round((clamped - min) / step);
  const snapped = min + steps * step;
  return Math.round(snapped * 1e6) / 1e6;
}

// ---- CS2 ----

const CS2_PARAMS: TuningParam[] = [
  { id: 'length', kind: 'number', min: 0, max: 10, step: 0.5 },
  { id: 'thickness', kind: 'number', min: 0, max: 6, step: 0.5 },
  { id: 'gap', kind: 'number', min: -5, max: 5, step: 0.5 },
  { id: 'outlineEnabled', kind: 'boolean' },
  { id: 'outline', kind: 'number', min: 0, max: 3, step: 0.5 },
  { id: 'alphaEnabled', kind: 'boolean' },
  { id: 'alpha', kind: 'number', min: 0, max: 255, step: 1 },
  { id: 'color', kind: 'palette', min: 0, max: 5, step: 1, paletteSize: 6 },
  { id: 'red', kind: 'number', min: 0, max: 255, step: 1 },
  { id: 'green', kind: 'number', min: 0, max: 255, step: 1 },
  { id: 'blue', kind: 'number', min: 0, max: 255, step: 1 },
  { id: 'centerDotEnabled', kind: 'boolean' },
  { id: 'tStyleEnabled', kind: 'boolean' },
];

function readCs2(settings: Cs2Settings, id: string): TuneValue {
  switch (id) {
    case 'length': return settings.length;
    case 'thickness': return settings.thickness;
    case 'gap': return settings.gap;
    case 'outlineEnabled': return settings.outlineEnabled;
    case 'outline': return settings.outline;
    case 'alphaEnabled': return settings.alphaEnabled;
    case 'alpha': return settings.alpha;
    case 'color': return settings.color;
    case 'red': return settings.red;
    case 'green': return settings.green;
    case 'blue': return settings.blue;
    case 'centerDotEnabled': return settings.centerDotEnabled;
    case 'tStyleEnabled': return settings.tStyleEnabled;
    default: throw unsupportedParam(id);
  }
}

function tuneCs2(parsed: Cs2Crosshair, changes: TuneChanges): Cs2Crosshair {
  const settings: Cs2Settings = { ...parsed.settings };
  for (const [id, raw] of Object.entries(changes)) {
    switch (id) {
      case 'length': settings.length = clampStep(asNumber(raw, id), 0, 10, 0.5); break;
      case 'thickness': settings.thickness = clampStep(asNumber(raw, id), 0, 6, 0.5); break;
      case 'gap': settings.gap = clampStep(asNumber(raw, id), -5, 5, 0.5); break;
      case 'outlineEnabled': settings.outlineEnabled = asBoolean(raw, id); break;
      case 'outline': settings.outline = clampStep(asNumber(raw, id), 0, 3, 0.5); break;
      case 'alphaEnabled': settings.alphaEnabled = asBoolean(raw, id); break;
      case 'alpha': settings.alpha = clampStep(asNumber(raw, id), 0, 255, 1); break;
      case 'color': settings.color = clampStep(asNumber(raw, id), 0, 5, 1); break;
      case 'red': settings.red = clampStep(asNumber(raw, id), 0, 255, 1); break;
      case 'green': settings.green = clampStep(asNumber(raw, id), 0, 255, 1); break;
      case 'blue': settings.blue = clampStep(asNumber(raw, id), 0, 255, 1); break;
      case 'centerDotEnabled': settings.centerDotEnabled = asBoolean(raw, id); break;
      case 'tStyleEnabled': settings.tStyleEnabled = asBoolean(raw, id); break;
      default: throw unsupportedParam(id);
    }
  }
  return { ...parsed, settings };
}

// ---- VALORANT (primary profile only) ----

const VALORANT_PARAMS: TuningParam[] = [
  { id: 'color', kind: 'palette', min: 0, max: 7, step: 1, paletteSize: 8 },
  { id: 'customColor', kind: 'color' },
  { id: 'useCustomColor', kind: 'boolean' },
  { id: 'outlines', kind: 'boolean' },
  { id: 'outlineThickness', kind: 'number', min: 1, max: 6, step: 1 },
  { id: 'outlineOpacity', kind: 'number', min: 0, max: 1, step: 0.05 },
  { id: 'centerDot', kind: 'boolean' },
  { id: 'dotThickness', kind: 'number', min: 1, max: 6, step: 1 },
  { id: 'dotOpacity', kind: 'number', min: 0, max: 1, step: 0.05 },
  { id: 'inner.enabled', kind: 'boolean' },
  { id: 'inner.opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
  { id: 'inner.length', kind: 'number', min: 0, max: 20, step: 1 },
  { id: 'inner.thickness', kind: 'number', min: 0, max: 10, step: 1 },
  { id: 'inner.offset', kind: 'number', min: 0, max: 20, step: 1 },
  { id: 'outer.enabled', kind: 'boolean' },
  { id: 'outer.opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
  { id: 'outer.length', kind: 'number', min: 0, max: 10, step: 1 },
  { id: 'outer.thickness', kind: 'number', min: 0, max: 10, step: 1 },
  { id: 'outer.offset', kind: 'number', min: 0, max: 40, step: 1 },
];

function splitLineId(id: string): ['inner' | 'outer', string] | null {
  if (id.startsWith('inner.')) return ['inner', id.slice('inner.'.length)];
  if (id.startsWith('outer.')) return ['outer', id.slice('outer.'.length)];
  return null;
}

function readValorantLine(line: ValorantLine, key: string, id: string): TuneValue {
  switch (key) {
    case 'enabled': return line.enabled;
    case 'opacity': return line.opacity;
    case 'length': return line.length;
    case 'thickness': return line.thickness;
    case 'offset': return line.offset;
    default: throw unsupportedParam(id);
  }
}

function readValorant(primary: ValorantProfile, id: string): TuneValue {
  const line = splitLineId(id);
  if (line) return readValorantLine(primary[line[0]], line[1], id);
  switch (id) {
    case 'color': return primary.color;
    case 'customColor': return primary.customColor;
    case 'useCustomColor': return primary.useCustomColor;
    case 'outlines': return primary.outlines;
    case 'outlineThickness': return primary.outlineThickness;
    case 'outlineOpacity': return primary.outlineOpacity;
    case 'centerDot': return primary.centerDot;
    case 'dotThickness': return primary.dotThickness;
    case 'dotOpacity': return primary.dotOpacity;
    default: throw unsupportedParam(id);
  }
}

function tuneValorantLine(line: ValorantLine, key: string, raw: unknown, id: string, side: 'inner' | 'outer'): void {
  switch (key) {
    case 'enabled': line.enabled = asBoolean(raw, id); break;
    case 'opacity': line.opacity = clampStep(asNumber(raw, id), 0, 1, 0.05); break;
    case 'length': line.length = clampStep(asNumber(raw, id), 0, side === 'inner' ? 20 : 10, 1); break;
    case 'thickness': line.thickness = clampStep(asNumber(raw, id), 0, 10, 1); break;
    case 'offset': line.offset = clampStep(asNumber(raw, id), 0, side === 'inner' ? 20 : 40, 1); break;
    default: throw unsupportedParam(id);
  }
}

function tuneValorant(parsed: ValorantCrosshair, changes: TuneChanges): ValorantCrosshair {
  const primary: ValorantProfile = { ...parsed.primary, inner: { ...parsed.primary.inner }, outer: { ...parsed.primary.outer } };
  for (const [id, raw] of Object.entries(changes)) {
    const line = splitLineId(id);
    if (line) { tuneValorantLine(primary[line[0]], line[1], raw, id, line[0]); continue; }
    switch (id) {
      case 'color': primary.color = clampStep(asNumber(raw, id), 0, 7, 1); primary.useCustomColor = false; break;
      case 'customColor': primary.customColor = asColorHex(raw, id); primary.useCustomColor = true; break;
      case 'useCustomColor': primary.useCustomColor = asBoolean(raw, id); break;
      case 'outlines': primary.outlines = asBoolean(raw, id); break;
      case 'outlineThickness': primary.outlineThickness = clampStep(asNumber(raw, id), 1, 6, 1); break;
      case 'outlineOpacity': primary.outlineOpacity = clampStep(asNumber(raw, id), 0, 1, 0.05); break;
      case 'centerDot': primary.centerDot = asBoolean(raw, id); break;
      case 'dotThickness': primary.dotThickness = clampStep(asNumber(raw, id), 1, 6, 1); break;
      case 'dotOpacity': primary.dotOpacity = clampStep(asNumber(raw, id), 0, 1, 0.05); break;
      default: throw unsupportedParam(id);
    }
  }
  return { ...parsed, primary };
}

/** The tunable parameters for a game, in display order. */
export function getTuningParams(game: CrosshairGame): TuningParam[] {
  if (game === 'cs2') return CS2_PARAMS;
  if (game === 'valorant') return VALORANT_PARAMS;
  throw new CrosshairError('INVALID_VALUE', '未知的准星游戏类型。', 'Unknown crosshair game type.');
}

/** Reads one parameter's current value off a parsed crosshair, for seeding tuner controls. */
export function readTuningValue(parsed: ParsedCrosshair, id: string): TuneValue {
  if (parsed.game === 'cs2') return readCs2(parsed.settings, id);
  if (parsed.game === 'valorant') return readValorant(parsed.primary, id);
  throw unsupportedParam(id);
}

/**
 * Returns a NEW parsed crosshair with `changes` applied; `parsed` is never mutated. Every
 * number/palette value is clamped into range and snapped to its step; every boolean and color
 * must already be the right JS type. An id this game does not expose is refused. The result
 * always satisfies `createScene`/`renderCrosshair`.
 */
export function tune(parsed: Cs2Crosshair, changes: TuneChanges): Cs2Crosshair;
export function tune(parsed: ValorantCrosshair, changes: TuneChanges): ValorantCrosshair;
export function tune(parsed: ParsedCrosshair, changes: TuneChanges): ParsedCrosshair;
export function tune(parsed: ParsedCrosshair, changes: TuneChanges): ParsedCrosshair {
  if (!isRecord(changes)) throw new CrosshairError('INVALID_VALUE', '微调修改必须是对象。', 'Tuning changes must be an object.');
  if (parsed.game === 'cs2') return tuneCs2(parsed, changes);
  if (parsed.game === 'valorant') return tuneValorant(parsed, changes);
  throw new CrosshairError('INVALID_VALUE', '无法识别准星游戏类型。', 'Unrecognized crosshair game type.');
}
