import { describe, expect, it } from 'vitest';
import { parseCs2 } from '../src/cs2';
import { parseValorant } from '../src/valorant';
import { renderCrosshair } from '../src/render';
import { CrosshairError } from '../src/errors';
import { getTuningParams, readTuningValue, tune } from '../src/tuning';
import { CS2_PALETTE, VALORANT_PALETTE } from '../src/palette';

const CJK = /[　-〿㐀-鿿＀-￯]/;
const sampleCs2 = 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG';
const sampleValorant = '0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0';

describe('palette tables', () => {
  it('CS2 has 5 presets, matching the color param range (index 5 is custom)', () => {
    expect(CS2_PALETTE).toHaveLength(5);
    const color = getTuningParams('cs2').find((p) => p.id === 'color')!;
    expect(color.max).toBe(CS2_PALETTE.length);
  });
  it('VALORANT has 8 presets, matching the color param range', () => {
    expect(VALORANT_PALETTE).toHaveLength(8);
    const color = getTuningParams('valorant').find((p) => p.id === 'color')!;
    expect(color.max).toBe(VALORANT_PALETTE.length - 1);
  });
  it('every preset has a distinct English and Chinese name', () => {
    for (const palette of [CS2_PALETTE, VALORANT_PALETTE]) {
      for (const entry of palette) {
        expect(entry.nameEn.length).toBeGreaterThan(0);
        expect(entry.nameZh.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('getTuningParams', () => {
  it('lists every CS2 parameter named in the roadmap', () => {
    const ids = getTuningParams('cs2').map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([
      'length', 'thickness', 'gap', 'outlineEnabled', 'outline',
      'alphaEnabled', 'alpha', 'color', 'red', 'green', 'blue',
      'centerDotEnabled', 'tStyleEnabled',
    ]));
  });
  it('lists every VALORANT primary parameter named in the roadmap', () => {
    const ids = getTuningParams('valorant').map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([
      'color', 'customColor', 'outlines', 'outlineThickness', 'outlineOpacity',
      'centerDot', 'dotThickness', 'dotOpacity',
      'inner.enabled', 'inner.opacity', 'inner.length', 'inner.thickness', 'inner.offset',
      'outer.enabled', 'outer.opacity', 'outer.length', 'outer.thickness', 'outer.offset',
    ]));
  });
  it('rejects an unknown game', () => {
    expect(() => getTuningParams('unknown' as never)).toThrow(CrosshairError);
  });
});

describe('tune: round-trip', () => {
  it('round-trips every CS2 number/boolean/palette parameter', () => {
    const parsed = parseCs2(sampleCs2);
    for (const param of getTuningParams('cs2')) {
      const value = param.kind === 'boolean' ? true : param.kind === 'number' || param.kind === 'palette' ? (param.min ?? 0) : '112233FF';
      const tuned = tune(parsed, { [param.id]: value });
      expect(readTuningValue(tuned, param.id)).toEqual(value);
    }
  });
  it('round-trips every VALORANT number/boolean/palette/color parameter', () => {
    const parsed = parseValorant(sampleValorant);
    for (const param of getTuningParams('valorant')) {
      const value = param.kind === 'boolean' ? true : param.kind === 'color' ? 'AABBCCDD' : (param.min ?? 0);
      const tuned = tune(parsed, { [param.id]: value });
      expect(readTuningValue(tuned, param.id)).toEqual(param.id === 'customColor' ? 'AABBCCDD' : value);
    }
  });
});

describe('tune: clamping', () => {
  it('clamps a CS2 number above range down to the max, snapped to its step', () => {
    const parsed = parseCs2(sampleCs2);
    const tuned = tune(parsed, { length: 999 });
    expect(tuned.settings.length).toBe(10);
  });
  it('clamps a CS2 number below range up to the min', () => {
    const parsed = parseCs2(sampleCs2);
    const tuned = tune(parsed, { gap: -999 });
    expect(tuned.settings.gap).toBe(-5);
  });
  it('snaps a CS2 value between steps to the nearest step', () => {
    const parsed = parseCs2(sampleCs2);
    const tuned = tune(parsed, { thickness: 2.26 });
    expect(tuned.settings.thickness).toBe(2.5);
  });
  it('clamps a VALORANT line parameter independently for inner and outer', () => {
    const parsed = parseValorant(sampleValorant);
    const tuned = tune(parsed, { 'inner.length': 999, 'outer.length': 999 });
    expect(tuned.primary.inner.length).toBe(20);
    expect(tuned.primary.outer.length).toBe(10);
  });
  it('rejects a value of the wrong JS type instead of coercing it', () => {
    const parsed = parseCs2(sampleCs2);
    expect(() => tune(parsed, { length: '5' as unknown as number })).toThrow(CrosshairError);
    expect(() => tune(parsed, { outlineEnabled: 1 as unknown as boolean })).toThrow(CrosshairError);
  });
  it('rejects an id the game does not expose', () => {
    const parsed = parseCs2(sampleCs2);
    expect(() => tune(parsed, { notAField: 1 })).toThrow(CrosshairError);
    const valorant = parseValorant(sampleValorant);
    expect(() => tune(valorant, { 'sniper.length': 1 })).toThrow(CrosshairError);
  });
  it('rejects a malformed VALORANT custom color', () => {
    const parsed = parseValorant(sampleValorant);
    expect(() => tune(parsed, { customColor: 'nope' })).toThrow(CrosshairError);
  });
});

describe('tune: purity', () => {
  it('never mutates the CS2 input, including nested settings', () => {
    const parsed = parseCs2(sampleCs2);
    const before = JSON.parse(JSON.stringify(parsed));
    tune(parsed, { length: 3, color: 5, red: 10 });
    expect(parsed).toEqual(before);
  });
  it('never mutates the VALORANT input, including nested line objects', () => {
    const parsed = parseValorant(sampleValorant);
    const before = JSON.parse(JSON.stringify(parsed));
    tune(parsed, { 'inner.length': 1, 'outer.thickness': 4, color: 3 });
    expect(parsed).toEqual(before);
  });
  it('selecting a VALORANT palette color turns useCustomColor back off', () => {
    const parsed = parseValorant(sampleValorant);
    const custom = tune(parsed, { customColor: '11223344' });
    expect(custom.primary.useCustomColor).toBe(true);
    const back = tune(custom, { color: 2 });
    expect(back.primary.useCustomColor).toBe(false);
    expect(back.primary.color).toBe(2);
  });
});

describe('tune: renders', () => {
  it('renders a tuned CS2 crosshair', () => {
    const parsed = parseCs2(sampleCs2);
    const tuned = tune(parsed, { length: 6, thickness: 2, color: 1, alpha: 200, alphaEnabled: true });
    const raster = renderCrosshair(tuned);
    expect(raster.width).toBeGreaterThan(0);
    expect(raster.height).toBeGreaterThan(0);
  });
  it('renders a tuned VALORANT crosshair', () => {
    const parsed = parseValorant(sampleValorant);
    const tuned = tune(parsed, { 'inner.length': 8, 'outer.opacity': 0.5, centerDot: true, dotThickness: 3 });
    const raster = renderCrosshair(tuned);
    expect(raster.width).toBeGreaterThan(0);
    expect(raster.height).toBeGreaterThan(0);
  });
});

describe('tune: messages', () => {
  it('carries zh then en on every thrown error, with no CJK in en', () => {
    const parsed = parseCs2(sampleCs2);
    const attempts: (() => unknown)[] = [
      () => tune(parsed, { notAField: 1 }),
      () => tune(parsed, { length: 'x' as unknown as number }),
      () => tune(parsed, { outlineEnabled: 'x' as unknown as boolean }),
      () => getTuningParams('nope' as never),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        expect.fail('expected a CrosshairError');
      } catch (error) {
        expect(error).toBeInstanceOf(CrosshairError);
        const err = error as CrosshairError;
        expect(err.message.length).toBeGreaterThan(0);
        expect(err.en.length).toBeGreaterThan(0);
        expect(CJK.test(err.en)).toBe(false);
      }
    }
  });
});
