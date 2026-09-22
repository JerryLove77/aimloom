import { CrosshairError } from './errors';
import { parseCs2 } from './cs2';
import { parseValorant } from './valorant';
import type { ParsedCrosshair, RenderOptions } from './render-types';
import { renderCrosshair, toSvg } from './render';

export { parseCs2 } from './cs2';
export type { Cs2Crosshair, Cs2Settings } from './cs2';
export { parseValorant } from './valorant';
export type { ValorantCrosshair, ValorantProfile, ValorantLine, ValorantSniper } from './valorant';
export { CrosshairError } from './errors';
export type { CrosshairErrorCode, CrosshairWarning } from './errors';
export { createScene, renderScene, renderCrosshair, toSvg } from './render';
export type { ParsedCrosshair, CrosshairProfile, RenderOptions, CrosshairRect, CrosshairScene, RasterImage } from './render-types';

export { canonicalPngIssue, encodePng, isCanonicalPng, sha256Hex, MAX_DIMENSION, MAX_PNG_BYTES } from './png';
export type { RgbaImage, CanonicalPngIssue } from './png';

export { getTuningParams, readTuningValue, tune } from './tuning';
export type { TuningParam, TuningParamKind, TuneChanges, TuneValue } from './tuning';

export { CS2_PALETTE, VALORANT_PALETTE } from './palette';
export type { PaletteColor } from './palette';

export function parseCrosshair(input: string): ParsedCrosshair {
  if (typeof input !== 'string') throw new CrosshairError('INVALID_CODE', '请粘贴 CS2 或 VALORANT 准星代码', 'Paste a CS2 or VALORANT crosshair code.');
  if (input.length > 4096) throw new CrosshairError('INPUT_TOO_LONG', '准星代码不能超过 4096 个字符', 'The crosshair code cannot exceed 4096 characters.');
  const code = input.trim();
  if (!code) throw new CrosshairError('EMPTY_INPUT', '请先输入准星代码', 'Enter a crosshair code first.');
  if (code.startsWith('CSGO')) return parseCs2(input);
  if (/^\d+;/.test(code)) return parseValorant(input);
  throw new CrosshairError('INVALID_CODE', '未识别准星代码，请使用 CSGO- 开头的 CS2 代码或 VALORANT 导出代码', 'Unrecognized crosshair code; use a CS2 code starting with CSGO- or a VALORANT export code.');
}

/** Explicit choices for consumers; legacy auto-detection remains available separately. */
export const CROSSHAIR_GAMES = [
  {id:'cs2',label:'CS2'},
  {id:'valorant',label:'VALORANT'},
] as const;
export type CrosshairGame = typeof CROSSHAIR_GAMES[number]['id'];

export function parseCrosshairForGame(game:CrosshairGame, code:string):ParsedCrosshair {
  if(game==='cs2')return parseCs2(code);
  if(game==='valorant')return parseValorant(code);
  throw new CrosshairError('INVALID_VALUE','请选择 CS2 或 VALORANT','Choose CS2 or VALORANT.');
}

/** Browser-safe static preview: selecting a game never falls back to another parser. */
export function previewCrosshairCode(game:CrosshairGame, code:string, options?:RenderOptions) {
  const parsed=parseCrosshairForGame(game,code);
  const raster=renderCrosshair(parsed,options);
  return {game:parsed.game,code:parsed.code,mode:'static' as const,raster,svg:toSvg(raster),warnings:raster.warnings};
}
