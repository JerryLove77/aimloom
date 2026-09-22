/**
 * The preset color tables CS2 and VALORANT crosshair codes select by index (render.ts) and the
 * tuner's palette swatches (CUR-C2) draw from directly, so the two stay in lockstep by
 * construction. Names are the closest common English/Chinese name for each preset, for an
 * accessible swatch label — not a claim about wording either game's own settings UI uses.
 */
export interface PaletteColor {
  rgb: readonly [number, number, number];
  nameZh: string;
  nameEn: string;
}

/** Indices 0–4; CS2 crosshair code index 5 selects a custom color instead (see cs2.ts). */
export const CS2_PALETTE: readonly PaletteColor[] = [
  { rgb: [255, 0, 0], nameZh: '红', nameEn: 'Red' },
  { rgb: [0, 255, 0], nameZh: '绿', nameEn: 'Green' },
  { rgb: [255, 255, 0], nameZh: '黄', nameEn: 'Yellow' },
  { rgb: [0, 0, 255], nameZh: '蓝', nameEn: 'Blue' },
  { rgb: [0, 255, 255], nameZh: '青', nameEn: 'Cyan' },
];

/** Indices 0–7; VALORANT's `useCustomColor`/`c: 8` selects a custom color instead (valorant.ts). */
export const VALORANT_PALETTE: readonly PaletteColor[] = [
  { rgb: [255, 255, 255], nameZh: '白', nameEn: 'White' },
  { rgb: [0, 255, 0], nameZh: '绿', nameEn: 'Green' },
  { rgb: [127, 255, 0], nameZh: '黄绿', nameEn: 'Chartreuse' },
  { rgb: [223, 255, 0], nameZh: '柠檬黄绿', nameEn: 'Yellow-green' },
  { rgb: [255, 255, 0], nameZh: '黄', nameEn: 'Yellow' },
  { rgb: [0, 255, 255], nameZh: '青', nameEn: 'Cyan' },
  { rgb: [255, 0, 255], nameZh: '品红', nameEn: 'Magenta' },
  { rgb: [255, 0, 0], nameZh: '红', nameEn: 'Red' },
];
