import { describe, expect, it } from 'vitest';
import { CrosshairError } from '../src/errors';
import type { Cs2Crosshair } from '../src/cs2';
import { parseValorant, type ValorantCrosshair, type ValorantLine, type ValorantProfile } from '../src/valorant';
import { createScene, renderCrosshair, renderScene, toSvg } from '../src/render';
import type { CrosshairProfile, CrosshairScene, ParsedCrosshair, RasterImage, RenderOptions } from '../src/render-types';

function valorantLine(): ValorantLine {
  return { enabled: true, opacity: 1, length: 4, verticalLength: 4, independentVerticalLength: false,
    thickness: 2, offset: 2, movementError: false, firingError: false, movementMultiplier: 1, firingMultiplier: 1 };
}

function valorantProfile(): ValorantProfile {
  return { color: 1, customColor: 'FFFFFFFF', useCustomColor: false, outlines: false,
    outlineThickness: 1, outlineOpacity: 1, centerDot: false, dotThickness: 2, dotOpacity: 1,
    fadeOnFire: false, overrideFiringError: false, showSpectated: true,
    inner: valorantLine(), outer: { ...valorantLine(), enabled: false } };
}

function valorant(): ValorantCrosshair {
  return { game: 'valorant', code: 'not used to construct geometry', primary: valorantProfile(),
    ads: { ...valorantProfile(), color: 7 },
    sniper: { color: 7, customColor: 'FFFFFFFF', useCustomColor: false, centerDot: true, dotThickness: 1, dotOpacity: 0.75 },
    global: { usePrimaryForAds: true, advanced: false, overrideSpectators: false }, warnings: [] };
}

function cs2(): Cs2Crosshair {
  return { game: 'cs2', code: 'not used to construct geometry', warnings: [], settings: {
    length: 2, red: 18, green: 171, blue: 239, gap: -2, alphaEnabled: true, alpha: 128,
    outlineEnabled: true, outline: 1, color: 5, thickness: 0.5, centerDotEnabled: false,
    splitDistance: 7, followRecoil: false, fixedCrosshairGap: 3, innerSplitAlpha: 1,
    outerSplitAlpha: 0.5, splitSizeRatio: 0.5, tStyleEnabled: false, deployedWeaponGapEnabled: false, style: 4,
  } };
}

function scene(overrides: Partial<CrosshairScene> = {}): CrosshairScene {
  return {
    rectangles: [{ x: -1, y: -1, width: 2, height: 2, opacity: 1 }],
    color: [0, 255, 0, 255], outlineThickness: 0, outlineOpacity: 1, warnings: [],
    ...overrides,
  };
}

function pixel(image: RasterImage, x: number, y: number): number[] {
  return [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
}

function expectError(run: () => unknown, code = 'INVALID_RENDER_OPTIONS'): void {
  try {
    run();
    expect.fail('Expected invalid rendering input to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(CrosshairError);
    expect(error).toMatchObject({ code });
  }
}

describe('createScene', () => {
  it('derives VALORANT arms from base offsets without depending on the code string', () => {
    expect(createScene(valorant())).toMatchObject({
      color: [0, 255, 0, 255], outlineThickness: 0,
      rectangles: [
        { x: -6, y: -1, width: 4, height: 2, opacity: 1 },
        { x: 2, y: -1, width: 4, height: 2, opacity: 1 },
        { x: -1, y: -6, width: 2, height: 4, opacity: 1 },
        { x: -1, y: 2, width: 2, height: 4, opacity: 1 },
      ],
    });
    const dynamic = valorant();
    dynamic.primary.inner.firingError = true;
    dynamic.primary.inner.movementError = true;
    expect(createScene(dynamic).rectangles[0]!.x).toBe(-6);
  });

  it('uses separate vertical lengths only when unlocked and omits zero-length axes', () => {
    const input = valorant();
    input.primary.inner.verticalLength = 0;
    expect(createScene(input).rectangles).toHaveLength(4);
    input.primary.inner.independentVerticalLength = true;
    input.primary.outer = { ...valorantLine(), length: 0, verticalLength: 3, independentVerticalLength: true, opacity: 0.5 };
    expect(createScene(input).rectangles).toEqual([
      { x: -6, y: -1, width: 4, height: 2, opacity: 1 },
      { x: 2, y: -1, width: 4, height: 2, opacity: 1 },
      { x: -1, y: -5, width: 2, height: 3, opacity: 0.5 },
      { x: -1, y: 2, width: 2, height: 3, opacity: 0.5 },
    ]);
  });

  it('preserves centered odd dots and skips disabled or zero-thickness groups', () => {
    const input = valorant();
    input.primary.centerDot = true;
    input.primary.dotThickness = 3;
    input.primary.dotOpacity = 0.75;
    input.primary.inner.thickness = 0;
    input.primary.outlines = true;
    input.primary.outlineOpacity = 0.25;
    expect(createScene(input)).toMatchObject({
      rectangles: [{ x: -1.5, y: -1.5, width: 3, height: 3, opacity: 0.75 }],
      outlineThickness: 1, outlineOpacity: 0.25,
    });
  });

  it.each([
    [0, [255, 255, 255, 255]], [1, [0, 255, 0, 255]], [2, [127, 255, 0, 255]],
    [3, [223, 255, 0, 255]], [4, [255, 255, 0, 255]], [5, [0, 255, 255, 255]],
    [6, [255, 0, 255, 255]], [7, [255, 0, 0, 255]],
  ])('selects VALORANT preset %i without activating stale custom color', (index, rgba) => {
    const input = valorant();
    input.primary.color = index as number;
    input.primary.customColor = '00000000';
    expect(createScene(input).color).toEqual(rgba);
  });

  it('honors the explicit custom-color flag and RGBA alpha independently of preset', () => {
    const input = valorant();
    input.primary.useCustomColor = true;
    input.primary.customColor = '12ABEF80';
    expect(createScene(input).color).toEqual([18, 171, 239, 128]);
  });

  it('renders primary for copied ADS and separately configured ADS when requested', () => {
    const input = valorant();
    expect(createScene(input, 'ads').color).toEqual([0, 255, 0, 255]);
    input.global.usePrimaryForAds = false;
    input.ads.inner.enabled = false;
    input.ads.centerDot = true;
    expect(createScene(input, 'ads')).toMatchObject({
      color: [255, 0, 0, 255], rectangles: [{ x: -1, y: -1, width: 2, height: 2, opacity: 1 }],
    });
    expect(createScene(input, 'primary').color).toEqual([0, 255, 0, 255]);
  });

  it('applies the documented CS2 static approximation for length, gap and thickness', () => {
    expect(createScene(cs2())).toMatchObject({
      color: [18, 171, 239, 128], outlineThickness: 1, outlineOpacity: 1,
      rectangles: [
        { x: -6, y: -0.5, width: 4, height: 1, opacity: 1 },
        { x: 2, y: -0.5, width: 4, height: 1, opacity: 1 },
        { x: -0.5, y: -6, width: 1, height: 4, opacity: 1 },
        { x: -0.5, y: 2, width: 1, height: 4, opacity: 1 },
      ],
      warnings: [expect.objectContaining({ code: 'STATIC_APPROXIMATION' })],
    });
    const input = cs2();
    input.settings.thickness = 0;
    input.settings.gap = -20;
    expect(createScene(input).rectangles[0]).toEqual({ x: -4, y: -0.5, width: 4, height: 1, opacity: 1 });
  });

  it('removes only the CS2 top arm for T-style and draws a thickness-sized center dot', () => {
    const input = cs2();
    input.settings.tStyleEnabled = true;
    input.settings.centerDotEnabled = true;
    input.settings.thickness = 1.5;
    expect(createScene(input).rectangles).toEqual([
      { x: -6, y: -1.5, width: 4, height: 3, opacity: 1 },
      { x: 2, y: -1.5, width: 4, height: 3, opacity: 1 },
      { x: -1.5, y: 2, width: 3, height: 4, opacity: 1 },
      { x: -1.5, y: -1.5, width: 3, height: 3, opacity: 1 },
    ]);
  });

  it.each([
    [0, [255, 0, 0, 255]], [1, [0, 255, 0, 255]], [2, [255, 255, 0, 255]],
    [3, [0, 0, 255, 255]], [4, [0, 255, 255, 255]],
  ])('uses CS2 preview preset %i and ignores disabled alpha', (index, rgba) => {
    const input = cs2();
    input.settings.color = index as number;
    input.settings.alphaEnabled = false;
    input.settings.outlineEnabled = false;
    expect(createScene(input).color).toEqual(rgba);
    expect(createScene(input).outlineThickness).toBe(0);
  });

  it('retains source diagnostics and creates an isolated warning list', () => {
    const input = cs2();
    input.warnings.push({ code: 'CS2_DYNAMIC_STATIC', message: '动态扩散未模拟' });
    const output = createScene(input);
    expect(output.warnings).toEqual([
      { code: 'CS2_DYNAMIC_STATIC', message: '动态扩散未模拟' },
      expect.objectContaining({ code: 'STATIC_APPROXIMATION' }),
    ]);
    output.warnings[0]!.message = 'modified';
    expect(input.warnings[0]!.message).toBe('动态扩散未模拟');
    expect(input.warnings).toHaveLength(1);
  });

  it('rejects unsupported profiles without silently falling back', () => {
    expectError(() => createScene(cs2(), 'ads'), 'UNSUPPORTED_PROFILE');
    expectError(() => createScene(valorant(), 'sniper' as CrosshairProfile), 'UNSUPPORTED_PROFILE');
  });

  it.each([null, {}, { game: 'other' }, { game: 'cs2', settings: null }, { game: 'valorant', primary: null }])('rejects malformed parsed input %j', input => {
    expectError(() => createScene(input as unknown as ParsedCrosshair));
  });

  it.each([
    ['length', NaN], ['length', 1e300], ['length', -1], ['gap', Infinity],
    ['thickness', '1'], ['color', 6], ['alpha', 256], ['tStyleEnabled', 'true'],
  ])('rejects invalid CS2 scene field %s', (field, value) => {
    const input = cs2();
    Object.assign(input.settings, { [field as string]: value });
    expectError(() => createScene(input));
  });

  it('rejects unsafe VALORANT geometry and custom colors from direct JavaScript callers', () => {
    const input = valorant();
    input.primary.inner.length = 1e300;
    expectError(() => createScene(input));
    input.primary.inner.length = 4;
    input.primary.useCustomColor = true;
    input.primary.customColor = 'not-hex';
    expectError(() => createScene(input));
  });
});

describe('renderCrosshair integration', () => {
  it('renders the external green VALORANT code into hand-derived pixels', () => {
    const parsed = parseValorant('0;s;1;P;c;1;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0');
    const image = renderCrosshair(parsed, { size: 16 });
    expect(pixel(image, 2, 7)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 8, 2)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 7, 7)).toEqual([0, 0, 0, 0]);
    expect(image.warnings).toEqual(parsed.warnings);
  });

  it('renders literal independent ADS as an outlined dot and honors profile options', () => {
    const parsed = parseValorant('0;p;0;s;1;P;h;0;0l;4;0o;0;0a;1;0f;0;1b;0;A;o;1;d;1;0b;0;1b;0');
    const image = renderCrosshair(parsed, { size: 16, profile: 'ads' });
    expect(pixel(image, 7, 7)).toEqual([255, 255, 255, 255]);
    expect(pixel(image, 6, 7)).toEqual([0, 0, 0, 255]);
    expect(pixel(image, 5, 7)).toEqual([0, 0, 0, 0]);
    expectError(() => renderCrosshair(cs2(), { profile: 'ads' }), 'UNSUPPORTED_PROFILE');
    expectError(() => renderCrosshair(cs2(), null as unknown as RenderOptions));
  });

  it('keeps named cyan when a literal code contains a stale pink custom field', () => {
    const parsed = parseValorant('0;P;c;5;u;FF5A97FF;o;1;d;1;f;0;0l;2;0o;0;0a;1;0f;0;1b;0');
    expect(pixel(renderCrosshair(parsed, { size: 16 }), 7, 7)).toEqual([0, 255, 255, 255]);
  });
});

describe('renderScene', () => {
  it('centers integer geometry on a transparent canvas with isolated output storage', () => {
    const input = scene();
    const image = renderScene(input, { size: 16 });
    expect([image.width, image.height, image.data.length]).toEqual([16, 16, 1024]);
    expect(pixel(image, 7, 7)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 8, 8)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 6, 7)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 9, 7)).toEqual([0, 0, 0, 0]);
    image.data.fill(0);
    expect(pixel(renderScene(input, { size: 16 }), 7, 7)).toEqual([0, 255, 0, 255]);
    expect(renderScene(input).width).toBe(128);
  });

  it('retains odd thickness and uses the fixed quarter-pixel sampling grid', () => {
    const oddDot = scene({ rectangles: [{ x: -0.5, y: -0.5, width: 1, height: 1, opacity: 1 }] });
    const image = renderScene(oddDot, { size: 16 });
    // Each of these four pixels contains four of sixteen foreground samples.
    expect(pixel(image, 7, 7)).toEqual([0, 255, 0, 64]);
    expect(pixel(image, 8, 8)).toEqual([0, 255, 0, 64]);
    const fractional = renderScene(scene({ rectangles: [{ x: 0, y: 0, width: 0.2, height: 1, opacity: 1 }] }), { size: 16 });
    expect(pixel(fractional, 8, 8)).toEqual([0, 255, 0, 64]);
  });

  it('composites overlapping fills at the maximum opacity without stacking', () => {
    const image = renderScene(scene({ rectangles: [
      { x: -1, y: -1, width: 2, height: 2, opacity: 0.4 },
      { x: -1, y: -1, width: 2, height: 2, opacity: 0.7 },
    ] }), { size: 16 });
    expect(pixel(image, 7, 7)).toEqual([0, 255, 0, 179]);
  });

  it('multiplies fill opacity by custom alpha and leaves black outline independent', () => {
    const image = renderScene(scene({
      rectangles: [{ x: -1, y: -1, width: 2, height: 2, opacity: 0.5 }],
      color: [18, 171, 239, 128], outlineThickness: 1, outlineOpacity: 0.75,
    }), { size: 16 });
    expect(pixel(image, 7, 7)).toEqual([18, 171, 239, 64]);
    expect(pixel(image, 6, 7)).toEqual([0, 0, 0, 191]);
  });

  it('places outlines outside the entire union without black under translucent interiors', () => {
    const image = renderScene(scene({
      rectangles: [
        { x: -2, y: -1, width: 2, height: 2, opacity: 0.5 },
        { x: 0, y: -1, width: 2, height: 2, opacity: 0.5 },
      ], outlineThickness: 1,
    }), { size: 16 });
    expect(pixel(image, 7, 7)).toEqual([0, 255, 0, 128]);
    expect(pixel(image, 8, 7)).toEqual([0, 255, 0, 128]);
    expect(pixel(image, 5, 7)).toEqual([0, 0, 0, 255]);
  });

  it('integrates mixed fill and outline samples in premultiplied alpha', () => {
    const image = renderScene(scene({
      rectangles: [{ x: -0.5, y: -1, width: 1, height: 2, opacity: 0.5 }], outlineThickness: 1,
    }), { size: 16 });
    // Half translucent green plus half opaque black: alpha 3/4, straight green 1/3.
    expect(pixel(image, 7, 7)).toEqual([0, 85, 0, 191]);
  });

  it('does not draw an interior outline when foreground opacity is zero', () => {
    const image = renderScene(scene({
      rectangles: [{ x: -1, y: -1, width: 2, height: 2, opacity: 0 }], outlineThickness: 1,
    }), { size: 16 });
    expect(pixel(image, 7, 7)).toEqual([0, 0, 0, 0]);
    expect(pixel(image, 6, 7)).toEqual([0, 0, 0, 255]);
  });

  it('scales geometry including outline around the canvas center', () => {
    const image = renderScene(scene({ outlineThickness: 1 }), { size: 16, scale: 2 });
    expect(pixel(image, 6, 6)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 4, 4)).toEqual([0, 0, 0, 255]);
    expect(pixel(image, 3, 4)).toEqual([0, 0, 0, 0]);
    expect(pixel(renderScene(scene(), { size: 16, scale: 0.25 }), 7, 7)).toEqual([0, 255, 0, 16]);
  });

  it('preserves diagnostics without mutating the source and warns on empty pixels', () => {
    const input = scene({ rectangles: [], warnings: [{ code: 'SOURCE', message: '来源警告' }] });
    const image = renderScene(input, { size: 16 });
    expect(image.data.every(value => value === 0)).toBe(true);
    expect(image.warnings).toEqual([
      { code: 'SOURCE', message: '来源警告' },
      expect.objectContaining({ code: 'EMPTY_CROSSHAIR' }),
    ]);
    expect(input.warnings).toHaveLength(1);
    image.warnings[0]!.message = 'changed';
    expect(input.warnings[0]!.message).toBe('来源警告');
    expect(renderScene(scene({ color: [255, 0, 0, 0] })).warnings).toContainEqual(expect.objectContaining({ code: 'EMPTY_CROSSHAIR' }));
  });

  it('skips zero area rectangles even with an enabled outline', () => {
    const image = renderScene(scene({ rectangles: [{ x: 0, y: 0, width: 0, height: 2, opacity: 1 }], outlineThickness: 1 }));
    expect(image.data.every(value => value === 0)).toBe(true);
  });

  it.each([
    { size: 15 }, { size: 513 }, { size: 16.5 }, { size: NaN }, { size: Infinity },
    { size: '16' }, { size: null }, { scale: 0 }, { scale: 0.249 }, { scale: 8.01 },
    { scale: Infinity }, { scale: NaN }, { scale: '1' }, { scale: null },
    { profile: 'sniper' }, null, [],
  ])('rejects invalid render options %j before allocation', options => {
    expectError(() => renderScene(scene(), options as unknown as RenderOptions));
  });

  it('accepts exact canvas bounds and rejects clipping including outlines', () => {
    const input = scene({ rectangles: [{ x: -8, y: -8, width: 16, height: 16, opacity: 1 }] });
    expect(pixel(renderScene(input, { size: 16 }), 0, 0)).toEqual([0, 255, 0, 255]);
    expectError(() => renderScene({ ...input, outlineThickness: 0.25 }, { size: 16 }));
    expectError(() => renderScene(input, { size: 16, scale: 1.01 }));
    expectError(() => renderScene(scene({ rectangles: [{ x: 999999, y: 0, width: 1, height: 1, opacity: 1 }] })));
  });

  it.each([
    null, {}, { color: [0, 256, 0, 255] }, { color: [0, 1.5, 0, 255] }, { color: [0, NaN, 0, 255] },
    { outlineThickness: Infinity }, { outlineThickness: -1 }, { outlineOpacity: 2 }, { warnings: null },
    { rectangles: null }, { rectangles: [null] },
    { rectangles: [{ x: NaN, y: 0, width: 1, height: 1, opacity: 1 }] },
    { rectangles: [{ x: 0, y: 0, width: -1, height: 1, opacity: 1 }] },
    { rectangles: [{ x: 0, y: 0, width: 1, height: 1, opacity: Infinity }] },
    { rectangles: Array.from({ length: 33 }, () => ({ x: 0, y: 0, width: 1, height: 1, opacity: 1 })) },
  ])('rejects malformed public scene data %j', invalid => {
    expectError(() => renderScene((invalid === null || Object.keys(invalid).length === 0 ? invalid : scene(invalid as Partial<CrosshairScene>)) as CrosshairScene));
  });
});

describe('toSvg', () => {
  it('emits only nontransparent numeric pixel runs with exact RGBA opacity', () => {
    const image: RasterImage = {
      width: 4, height: 1,
      data: new Uint8Array([18, 171, 239, 128, 18, 171, 239, 128, 0, 0, 0, 0, 255, 0, 0, 255]),
      warnings: [{ code: '<script>', message: '\"/><script>alert(1)</script>' }],
    };
    const svg = toSvg(image);
    expect(svg).toContain('viewBox="0 0 4 1"');
    expect(svg).toContain('<rect x="0" y="0" width="2" height="1" fill="rgb(18,171,239)" fill-opacity="0.5019607843137255"/>');
    expect(svg).toContain('<rect x="3" y="0" width="1" height="1" fill="rgb(255,0,0)" fill-opacity="1"/>');
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('alert');
  });

  it('accepts imported 1x1 rasters and encodes fully transparent images without shapes', () => {
    const svg = toSvg({ width: 1, height: 1, data: new Uint8Array(4), warnings: [] });
    expect(svg).toContain('width="1" height="1"');
    expect(svg).not.toContain('<rect');
  });

  it.each([
    null, { width: 0 }, { width: 513 }, { width: 1.5 }, { width: NaN }, { width: '1' },
    { height: Infinity }, { height: -1 }, { data: new Uint8Array(3) }, { data: [0, 0, 0, 0] },
  ])('rejects invalid dimensions or pixel storage %j before generating markup', invalid => {
    const value = invalid === null ? null : { width: 1, height: 1, data: new Uint8Array(4), warnings: [], ...invalid };
    expectError(() => toSvg(value as RasterImage));
  });
});
