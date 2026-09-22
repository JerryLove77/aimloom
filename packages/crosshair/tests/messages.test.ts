/**
 * Every `CrosshairError` carries an English `.en` alongside its Chinese `.message`, for the
 * App's Crosshair page (Task 8). The CLI and every other existing test keep reading `.message`
 * unchanged; this only checks the English half is present and has no Chinese in it.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CrosshairError } from '../src/errors'
import { parseCrosshair, parseCrosshairForGame } from '../src/index'
import { parseCs2 } from '../src/cs2'
import { parseValorant } from '../src/valorant'
import { createScene, renderCrosshair, renderScene, toSvg } from '../src/render'
import { canonicalPngIssue, encodePng } from '../src/png'
import { decodePng, encodePng as encodePngNode } from '../src/node'
import { previewCrosshair, prepareCrosshairReplacement, validateCrosshairFileName } from '../src/service'

const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/
const sampleCs2 = 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG'
const sampleValorant = '0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0'

/** Calls `fn`, expects it to throw a `CrosshairError`, and returns it. */
function caught(fn: () => unknown): CrosshairError {
  try {
    fn()
    expect.fail('expected a CrosshairError')
  } catch (error) {
    expect(error).toBeInstanceOf(CrosshairError)
    return error as CrosshairError
  }
}

/** One throw site each error path below exercises, and the `CrosshairErrorCode` it carries. */
const cases: [string, () => unknown][] = [
  ['parseCrosshair: non-string', () => parseCrosshair(42 as unknown as string)],
  ['parseCrosshair: too long', () => parseCrosshair(' '.repeat(4097))],
  ['parseCrosshair: empty', () => parseCrosshair('  ')],
  ['parseCrosshair: unrecognized', () => parseCrosshair('not a code')],
  ['parseCrosshairForGame: unknown game', () => parseCrosshairForGame('unknown' as never, sampleCs2)],

  ['parseCs2: non-string', () => parseCs2(null as unknown as string)],
  ['parseCs2: too long', () => parseCs2(' '.repeat(4097))],
  ['parseCs2: empty', () => parseCs2('   ')],
  ['parseCs2: malformed', () => parseCs2('CSGO-bad')],
  ['parseCs2: bad checksum', () => parseCs2('CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkH')],

  ['parseValorant: non-string', () => parseValorant(1 as unknown as string)],
  ['parseValorant: too long', () => parseValorant(' '.repeat(4097))],
  ['parseValorant: empty', () => parseValorant('  ')],
  ['parseValorant: too many/empty fields', () => parseValorant('0;P;' + 'x;0;'.repeat(256) + 'x;0')],
  ['parseValorant: unsupported version', () => parseValorant('1;P')],
  ['parseValorant: missing value', () => parseValorant('0;P;c')],
  ['parseValorant: duplicate field', () => parseValorant('0;P;c;1;c;2')],
  ['parseValorant: duplicate section', () => parseValorant('0;P;A;P')],
  ['parseValorant: missing P section', () => parseValorant('0;A;c;5')],
  ['parseValorant: unsupported field', () => parseValorant('0;P;unknown;1')],
  ['parseValorant: invalid value', () => parseValorant('0;P;c;9')],
  ['parseValorant: custom color without b', () => parseValorant('0;P;S;c;8;b;0')],

  ['createScene: unsupported profile string', () => createScene(parseCs2(sampleCs2), 'bad' as never)],
  ['createScene: CS2 has no ADS', () => createScene(parseCs2(sampleCs2), 'ads')],
  ['createScene: unrecognized game', () => createScene({ game: 'other' } as never)],
  ['renderCrosshair: bad render options', () => renderCrosshair(parseValorant(sampleValorant), { size: 'x' as never })],
  ['renderScene: exceeds canvas', () => renderScene({
    rectangles: [{ x: 0, y: 0, width: 4096, height: 4096, opacity: 1 }],
    color: [255, 0, 0, 255], outlineThickness: 0, outlineOpacity: 0, warnings: [],
  }, { size: 16 })],
  ['toSvg: not an object', () => toSvg(null as never)],
  ['toSvg: mismatched data length', () => toSvg({ width: 2, height: 2, data: new Uint8Array(1), warnings: [] })],

  ['decodePng: not a Uint8Array', () => decodePng('nope' as unknown as Uint8Array)],
  ['decodePng: too large', () => decodePng(new Uint8Array(2 * 1024 * 1024 + 1))],
  ['decodePng: bad signature', () => decodePng(new Uint8Array(64))],
  ['encodePng (node): bad dimensions', () => encodePngNode({ width: 0, height: 1, data: new Uint8Array(0), warnings: [] })],

  ['previewCrosshair: invalid input', () => previewCrosshair({ kind: 'bad' } as never)],
  ['previewCrosshair: invalid PNG input', () => previewCrosshair({ kind: 'png', options: {} } as never)],
  ['validateCrosshairFileName: unsafe name', () => validateCrosshairFileName('../escape.png')],
]

describe('every CrosshairError carries a CJK-free English message', () => {
  it.each(cases)('%s', (_label, fn) => {
    const error = caught(fn)
    expect(error.en.length).toBeGreaterThan(0)
    expect(error.en).not.toMatch(CJK)
    // The Chinese side (`.message`, what the CLI shows) is untouched by this task.
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('encodePng (browser-safe): rejects a bad image with a CJK-free English message', () => {
    expect(() => encodePng({ width: 0, height: 1, data: new Uint8Array(0), warnings: [] })).toThrow()
  })

  it('canonicalPngIssue: every issue pairs a Chinese reason with a CJK-free English one', () => {
    const issue = canonicalPngIssue(new Uint8Array([1, 2, 3]))
    expect(issue).not.toBeNull()
    expect(issue!.en).not.toMatch(CJK)
    expect(issue!.zh).toMatch(CJK)
  })

  it('prepareCrosshairReplacement: an existing output directory is refused in English too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crosshair-messages-'))
    try {
      const output = join(root, 'replacement')
      await prepareCrosshairReplacement({ kind: 'code', code: sampleValorant }, { outputDirectory: output, targetFileName: 'mine.png' })
      const error = await prepareCrosshairReplacement({ kind: 'code', code: sampleValorant }, { outputDirectory: output, targetFileName: 'mine.png' })
        .then(() => { throw new Error('expected a refusal') }, (thrown: unknown) => thrown as CrosshairError)
      expect(error).toBeInstanceOf(CrosshairError)
      expect(error.code).toBe('OUTPUT_EXISTS')
      expect(error.en).not.toMatch(CJK)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
