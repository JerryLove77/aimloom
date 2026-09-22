import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CrosshairError } from '../src/errors';
import { parseValorant } from '../src/valorant';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/valorant.json', import.meta.url), 'utf8')) as {
  id: string; code: string; expected: object;
}[];

function expectError(code: string, errorCode: string, field?: string) {
  try {
    parseValorant(code);
    expect.fail('Expected the crosshair code to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(CrosshairError);
    expect(error).toMatchObject({ code: errorCode, ...(field ? { field } : {}) });
  }
}

describe('parseValorant', () => {
  it.each([null, undefined, 1, false, {}, ['0', 'P']].map(input => ({ input })))('rejects non-string runtime input $input with a structured error', ({ input }) => {
    expectError(input as unknown as string, 'INVALID_CODE');
  });

  it.each(fixtures)('decodes independently sourced $id', ({ code, expected }) => {
    expect(parseValorant(code)).toMatchObject(expected);
  });

  it('fills omitted settings without leaking primary changes into ADS or later imports', () => {
    const first = parseValorant('0;P;c;5;0l;4');
    expect(first.primary).toMatchObject({
      customColor: 'FFFFFFFF', useCustomColor: false, outlines: true, outlineThickness: 1,
      outlineOpacity: 0.5, centerDot: false, dotThickness: 2, dotOpacity: 1,
      fadeOnFire: true, showSpectated: true, overrideFiringError: false,
      inner: { opacity: 0.8, thickness: 2, offset: 3, movementError: false, firingError: true },
      outer: { opacity: 0.35, length: 2, offset: 10, movementError: true, firingError: true },
    });
    expect(first.ads).toMatchObject({ color: 0, inner: { length: 6 } });
    first.primary.inner.length = 19;
    first.ads.outer.offset = 20;
    expect(parseValorant('0;P')).toMatchObject({
      primary: { color: 0, inner: { length: 6 }, outer: { offset: 10 } },
      ads: { inner: { length: 6 }, outer: { offset: 10 } },
      sniper: { color: 7, centerDot: true, dotThickness: 1, dotOpacity: 0.75 },
      global: { usePrimaryForAds: true, advanced: false, overrideSpectators: false },
    });
  });

  it('accepts independent section order and preserves ADS and sniper settings', () => {
    const parsed = parseValorant('0;c;1;s;1;p;0;S;b;1;c;8;t;12aBeF80;s;0.652;o;0.123;A;c;7;f;0;s;0;P;c;5');
    expect(parsed).toMatchObject({
      global: { overrideSpectators: true, usePrimaryForAds: false, advanced: true },
      primary: { color: 5, showSpectated: true },
      ads: { color: 7, fadeOnFire: false, showSpectated: false },
      sniper: { color: 8, customColor: '12ABEF80', useCustomColor: true, dotThickness: 0.652, dotOpacity: 0.123 },
    });
    expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: 'VALORANT_SNIPER_NOT_RENDERED' }));
  });

  it('reports ADS copy and omitted ADS defaults without discarding independent settings', () => {
    const copy = parseValorant('0;P;c;5;A;c;7');
    expect(copy.ads.color).toBe(7);
    expect(copy.global.usePrimaryForAds).toBe(true);
    expect(copy.warnings).toContainEqual(expect.objectContaining({ code: 'VALORANT_ADS_USES_PRIMARY' }));
    expect(parseValorant('0;p;0;P').warnings).toContainEqual(expect.objectContaining({ code: 'VALORANT_ADS_DEFAULT' }));
  });

  it('reports active dynamic error behavior but ignores disabled line groups', () => {
    expect(parseValorant('0;P').warnings).toContainEqual(expect.objectContaining({ code: 'VALORANT_DYNAMIC_STATIC' }));
    expect(parseValorant('0;P;0f;0;1b;0').warnings.map(warning => warning.code)).not.toContain('VALORANT_DYNAMIC_STATIC');
  });

  it('still reports dynamic lines whose outline is visible when their fill is transparent', () => {
    expect(parseValorant('0;P;0a;0;1b;0').warnings).toContainEqual(expect.objectContaining({ code: 'VALORANT_DYNAMIC_STATIC' }));
  });

  it('normalizes boundary whitespace and hex without rounding decimal settings', () => {
    const parsed = parseValorant(' \n0;P;c;8;u;12abef;b;1;o;0.374;0e;0.053\n ');
    expect(parsed.code).toBe('0;P;c;8;u;12abef;b;1;o;0.374;0e;0.053');
    expect(parsed.primary).toMatchObject({ customColor: '12ABEFFF', outlineOpacity: 0.374, inner: { firingMultiplier: 0.053 } });
  });

  it('selects custom color from either supported flag, independently of field order', () => {
    expect(parseValorant('0;P;b;1;u;00FF0080;c;1').primary).toMatchObject({ color: 1, useCustomColor: true, customColor: '00FF0080' });
    expect(parseValorant('0;P;c;8').primary).toMatchObject({ useCustomColor: true, customColor: 'FFFFFFFF' });
    expectError('0;P;c;8;b;0', 'INVALID_VALUE', 'P.b');
    expectError('0;P;b;0;c;8', 'INVALID_VALUE', 'P.b');
  });

  it('accepts schema endpoints and zero line geometry', () => {
    expect(parseValorant('0;P;t;6;z;6;0t;0;0l;20;0v;0;0o;20;0a;0;0s;3;1t;10;1l;10;1v;10;1o;40;1e;0;S;s;4;o;0')).toMatchObject({
      primary: { outlineThickness: 6, dotThickness: 6, inner: { thickness: 0, length: 20, verticalLength: 0, offset: 20, opacity: 0, movementMultiplier: 3 }, outer: { thickness: 10, length: 10, verticalLength: 10, offset: 40, firingMultiplier: 0 } },
      sniper: { dotThickness: 4, dotOpacity: 0 },
    });
  });

  it.each([
    ['', 'EMPTY_INPUT'], [' \n ', 'EMPTY_INPUT'], ['1;P', 'UNSUPPORTED_VERSION'],
    ['CSGO-abc', 'UNSUPPORTED_VERSION'], ['0', 'INVALID_CODE'], ['0;A;c;5', 'INVALID_CODE'],
    ['0;P;', 'INVALID_CODE'], ['0;;P', 'INVALID_CODE'], ['0;P;c', 'INVALID_CODE'],
    ['0;P;c;A;d;1', 'INVALID_CODE'], ['0;P;c;1;c;2', 'INVALID_CODE'],
    ['0;p;0;p;1;P', 'INVALID_CODE'], ['0;P;A;P', 'INVALID_CODE'],
    ['0;P;S;S', 'INVALID_CODE'], ['0;P;A;c;5;c;6', 'INVALID_CODE'],
    ['0;P;unknown;1', 'UNSUPPORTED_FIELD'], ['0;P;__proto__;1', 'UNSUPPORTED_FIELD'],
    ['0;P;NAME;foo', 'UNSUPPORTED_FIELD'], ['0;P;S;u;ABCDEF', 'UNSUPPORTED_FIELD'],
    ['0;P;c; 1', 'INVALID_VALUE'], ['0;P;c;1\n;h;0', 'INVALID_VALUE'],
  ])('rejects malformed input %j', (code, errorCode) => {
    expectError(code, errorCode);
  });

  it.each([
    ['P;c;9', 'P.c'], ['P;c;1.5', 'P.c'], ['P;h;2', 'P.h'], ['p;2;P', '0.p'],
    ['P;t;0', 'P.t'], ['P;t;7', 'P.t'], ['P;z;0', 'P.z'], ['P;z;7', 'P.z'],
    ['P;o;1.001', 'P.o'], ['P;0a;-0.1', 'P.0a'], ['P;0t;11', 'P.0t'],
    ['P;0l;21', 'P.0l'], ['P;0v;21', 'P.0v'], ['P;0o;21', 'P.0o'],
    ['P;1l;11', 'P.1l'], ['P;1v;11', 'P.1v'], ['P;1o;41', 'P.1o'],
    ['P;0s;3.001', 'P.0s'], ['P;1e;4', 'P.1e'], ['P;0g;2', 'P.0g'],
    ['P;0l;0.5', 'P.0l'], ['P;c;NaN', 'P.c'], ['P;o;Infinity', 'P.o'],
    ['P;0l;4px', 'P.0l'], ['P;0l;1e1', 'P.0l'], ['P;c;+1', 'P.c'],
    ['P;u;GG0000FF', 'P.u'], ['P;u;#00FF00', 'P.u'], ['P;u;00FF0', 'P.u'],
    ['P;A;1o;41', 'A.1o'], ['P;S;s;4.01', 'S.s'], ['P;S;o;1.1', 'S.o'],
    ['P;S;c;8;b;0', 'S.b'],
  ])('rejects invalid setting %s with its field location', (suffix, field) => {
    expectError(`0;${suffix}`, 'INVALID_VALUE', field);
  });

  it('bounds the raw input before trim or token processing', () => {
    expectError(' '.repeat(4096) + '0;P', 'INPUT_TOO_LONG');
    expectError('0;P;' + 'x;0;'.repeat(256) + 'x;0', 'INVALID_CODE');
  });

  it('validates ignored ADS and sniper data before yielding any primary result', () => {
    expectError('0;p;1;P;c;5;A;0l;999', 'INVALID_VALUE', 'A.0l');
    expectError('0;P;c;5;S;s;NaN', 'INVALID_VALUE', 'S.s');
  });

  it.each(['\u001b[31mowned', 'unknown\ninjected'])('keeps untrusted field %j out of printable errors', key => {
    for (const suffix of [`${key};1`, key]) {
      try {
        parseValorant(`0;P;${suffix}`);
        expect.fail('Expected an unknown or incomplete field to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(CrosshairError);
        expect((error as CrosshairError).message).not.toContain(key);
        expect((error as CrosshairError).message).not.toMatch(/[\u0000-\u001f\u007f]/);
        expect((error as CrosshairError).field).toBe(`P.${key}`);
      }
    }
  });
});
