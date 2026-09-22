import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCs2, type Cs2Settings } from '../src/cs2';

const fixtureData = JSON.parse(
  readFileSync(new URL('./fixtures/cs2.json', import.meta.url), 'utf8'),
) as { fixtures: { shareCode: string; crosshair: Cs2Settings }[] };

const sampleCode = 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG';

// Synthetic validation inputs, separate from the six external upstream fixtures.
// This literal is the independently inspected packed form of sampleCode.
const sampleBytes = [105, 1, 243, 4, 175, 81, 213, 137, 6, 30, 109, 84, 12, 244, 46, 0, 0, 0];
const alphabet = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';

function packInteger(value: bigint): string {
  let payload = '';
  for (let i = 0; i < 25; i++) {
    payload += alphabet[Number(value % 57n)];
    value /= 57n;
  }
  return `CSGO-${payload.match(/.{5}/g)!.join('-')}`;
}

function syntheticCode(change: (bytes: number[]) => void, checksum = true): string {
  const bytes = [...sampleBytes];
  change(bytes);
  if (checksum) bytes[0] = bytes.slice(1).reduce((sum, byte) => sum + byte, 0) % 256;
  return packInteger(BigInt(`0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`));
}

describe('parseCs2', () => {
  it.each(fixtureData.fixtures)('decodes external fixture $shareCode without changing its settings', ({ shareCode, crosshair }) => {
    const result = parseCs2(shareCode);
    expect(result).toMatchObject({ game: 'cs2', code: shareCode });
    expect(result.settings).toEqual(crosshair);
  });

  it('accepts outer whitespace while retaining the canonical case-sensitive code', () => {
    expect(parseCs2(` \r\n${sampleCode}\t `).code).toBe(sampleCode);
  });

  it.each([
    { label: 'null', input: null },
    { label: 'undefined', input: undefined },
    { label: 'number', input: 42 },
    { label: 'boolean', input: true },
    { label: 'array', input: [sampleCode] },
    { label: 'object with a misleading length', input: { length: 5000 } },
  ])('rejects a runtime $label with a structured error', ({ input }) => {
    expect(() => parseCs2(input as unknown as string))
      .toThrowError(expect.objectContaining({ name: 'CrosshairError', code: 'INVALID_CODE' }));
  });

  it.each(['', ' \t\r\n '])('rejects empty input %j', (input) => {
    expect(() => parseCs2(input)).toThrowError(expect.objectContaining({ code: 'EMPTY_INPUT' }));
  });

  it('enforces the input bound before trimming', () => {
    expect(() => parseCs2(' '.repeat(4097) + sampleCode))
      .toThrowError(expect.objectContaining({ code: 'INPUT_TOO_LONG' }));
  });

  it('accepts a valid code padded exactly to the input limit', () => {
    expect(parseCs2(' '.repeat(4096 - sampleCode.length) + sampleCode).code).toBe(sampleCode);
  });

  it.each([
    ['missing group', 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ'],
    ['missing separators', 'CSGO-Cn37RYE7vopLCALaURmZz6zkG'],
    ['extra suffix', `${sampleCode}A`],
    ['lowercase prefix', 'csgo-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['altered payload case', 'CSGO-cn37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['internal whitespace', 'CSGO-Cn37R-YE7vo- pLCAL-aURmZ-z6zkG'],
    ['excluded uppercase I', 'CSGO-In37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['excluded lowercase g', 'CSGO-gn37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['excluded digit zero', 'CSGO-0n37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['excluded digit one', 'CSGO-1n37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['underscore', 'CSGO-_n37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['Unicode lookalike', 'CSGO-Ｃn37R-YE7vo-pLCAL-aURmZ-z6zkG'],
    ['match replay code', 'CSGO-L9spZ-ihuov-cyhtE-kxbqa-FkBAA'],
  ])('rejects %s instead of silently normalizing it', (_label, code) => {
    expect(() => parseCs2(code)).toThrowError(expect.objectContaining({ code: 'INVALID_CODE' }));
  });

  it('rejects a packed value that cannot fit in 18 bytes', () => {
    expect(() => parseCs2(packInteger(1n << 144n)))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CODE' }));
  });

  it('rejects a checksum mismatch even when alphabet and grouping are valid', () => {
    const corrupted = syntheticCode((bytes) => { bytes[0] = 106; }, false);
    expect(() => parseCs2(corrupted)).toThrowError(expect.objectContaining({ code: 'INVALID_CODE' }));
  });

  it.each([0, 2, 255])('rejects unsupported wire version %i with a valid checksum', (version) => {
    const code = syntheticCode((bytes) => { bytes[1] = version; });
    expect(() => parseCs2(code))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION', field: 'version' }));
  });

  it.each([
    [8, 8], [8, 16], [8, 32], [8, 64], [13, 245], [15, 1], [16, 1], [17, 1],
  ])('rejects unrecognized data in byte %i instead of discarding it', (index, value) => {
    const code = syntheticCode((bytes) => { bytes[index] = value; });
    expect(() => parseCs2(code)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_FIELD' }));
  });

  it.each([6, 7])('rejects unknown color preset %i', (color) => {
    const code = syntheticCode((bytes) => { bytes[10] = (109 & ~7) | color; });
    expect(() => parseCs2(code))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_FIELD', field: 'color' }));
  });

  it.each([6, 7])('rejects unknown style %i', (style) => {
    const code = syntheticCode((bytes) => { bytes[13] = (244 & ~14) | (style << 1); });
    expect(() => parseCs2(code))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_FIELD', field: 'style' }));
  });

  it.each([0, 1, 3])('preserves disabled legacy style %i and reports that it cannot be reproduced', (style) => {
    const code = syntheticCode((bytes) => { bytes[13] = (244 & ~14) | (style << 1); });
    const result = parseCs2(code);
    expect(result.settings.style).toBe(style);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CS2_DISABLED_STYLE' }),
    ]));
  });

  it.each([2, 5])('reports dynamic behavior for style %i', (style) => {
    const code = syntheticCode((bytes) => { bytes[13] = (244 & ~14) | (style << 1); });
    expect(parseCs2(code).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CS2_DYNAMIC_STYLE' }),
    ]));
  });

  it('preserves recoil and weapon-dependent gap with separate warnings', () => {
    const result = parseCs2('CSGO-WsnnD-eHaMw-QNDf9-oxuDh-ydOUD');
    expect(result.settings).toMatchObject({ followRecoil: true, deployedWeaponGapEnabled: true });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CS2_FOLLOW_RECOIL' }),
      expect.objectContaining({ code: 'CS2_WEAPON_GAP' }),
    ]));
  });

  it('does not warn about dynamic behavior for a static crosshair with both dynamic flags off', () => {
    const code = syntheticCode((bytes) => { bytes[13] = 216; }); // style4, dot, alpha, T; weapon gap off
    expect(parseCs2(code).warnings).toEqual([]);
  });

  it('preserves wire-range extremes instead of imposing guessed game UI ranges', () => {
    const code = syntheticCode((bytes) => {
      bytes[2] = 128;
      bytes[3] = 255;
      bytes[9] = 127;
      bytes[10] = 253; // custom RGB, outline enabled, inner alpha1.5
      bytes[11] = 255;
      bytes[12] = 255;
      bytes[14] = 255;
    });
    expect(parseCs2(code).settings).toMatchObject({
      gap: -12.8, outline: 127.5, fixedCrosshairGap: 12.7,
      innerSplitAlpha: 1.5, outerSplitAlpha: 1.5, splitSizeRatio: 1.5,
      thickness: 25.5, length: 25.5,
    });
  });
});
