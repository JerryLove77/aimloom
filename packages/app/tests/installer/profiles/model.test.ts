import { describe, expect, it } from 'vitest'
import { createTrainingProfile, deserializeTrainingProfile, duplicateTrainingProfile, parseTrainingProfile, renameTrainingProfile, resolveProfileAssetPath, serializeTrainingProfile } from '../../../src/profiles/model'

const ref = (path: string) => ({ name: path.split(/[\\/]/).pop()!, path })
const example = () => ({ schemaVersion: 1, id: 'warmup-1', name: '热身', scheme: ref('../方案/main.JSON'), audio: { kill: [ref('a.WAV'), ref('b.ogg'), ref('a.WAV')], spawn: [] } })

describe('TrainingProfile JSON', () => {
  it('round trips all choices while preserving audio order and duplicates', () => {
    const value = example()
    expect(deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(value)))).toEqual(value)
  })
  it('creates explicit keep-current choices and preserves omitted event choices', () => {
    expect(createTrainingProfile('new', 'New')).toEqual({ schemaVersion: 1, id: 'new', name: 'New', scheme: null, audio: null })
    expect(parseTrainingProfile({ ...example(), audio: {} }).audio).toEqual({})
  })
  it.each([
    null, [], new Date(), { ...example(), extra: 1 }, { ...example(), schemaVersion: 2 },
    { ...example(), scheme: undefined }, { ...example(), name: '  ' }, { ...example(), name: 'a\nb' }, { ...example(), name: 'x'.repeat(129) },
    { ...example(), audio: { hit: [] } }, { ...example(), audio: { kill: 'a.wav' } }, { ...example(), audio: { kill: Array(65).fill('a.wav') } },
    { ...example(), scheme: { file: 'a.json', extra: true } },
    Object.assign(Object.create({}), example()),
  ])('rejects malformed profile %#', value => expect(() => parseTrainingProfile(value)).toThrow())
  it.each(['../bad', 'UPPER', '', 'con', 'com1', 'lpt9', 'a'.repeat(65)])('rejects unsafe id %s', id => {
    expect(() => createTrainingProfile(id, 'Name')).toThrow()
  })
  it.each(['https://host/a.json', 'data:a.json', 'C:relative.json', 'a.json?x', 'a.json#x', 'a.png', 'a\n.json', ' ', 'x'.repeat(4097) + '.json'])('rejects invalid scheme reference %#', file => {
    expect(() => parseTrainingProfile({ ...example(), scheme: ref(file) })).toThrow()
  })
  it('enforces the UTF-8 byte limit on parsed and serialized input', () => {
    const big = { ...example(), audio: { kill: Array(64).fill(ref('界'.repeat(1400) + '.wav')) } }
    expect(() => parseTrainingProfile(big)).toThrow()
    expect(() => serializeTrainingProfile(big as never)).toThrow()
    expect(() => deserializeTrainingProfile(' '.repeat(262145))).toThrow()
    expect(() => deserializeTrainingProfile('{bad')).toThrow()
  })
  // v0.1.2 recorded a crosshair. A crosshair cannot be switched from outside the game, so the
  // slot is gone -- but a Profile a player already saved has to keep opening, and must not lose
  // anything else on the way.
  it('opens a Profile saved before the crosshair slot existed, and drops only that record', () => {
    const legacy = { ...example(), crosshair: { name: 'red.PNG', path: 'C:/准星/red.PNG' } }
    const parsed = parseTrainingProfile(legacy)
    expect(parsed).toEqual(parseTrainingProfile(example()))
    expect(Object.hasOwn(parsed, 'crosshair')).toBe(false)
    expect(Object.hasOwn(JSON.parse(serializeTrainingProfile(parsed)), 'crosshair')).toBe(false)
  })
  // The old field is discarded without being validated, so a record that can no longer reach
  // anything is never the reason a Profile refuses to load.
  it.each([{ file: 'a.jpg' }, { file: 'x.png', sourceCode: 'code' }, 'not an object', 42, null])(
    'opens an old Profile whose crosshair record was malformed %#',
    junk => expect(() => parseTrainingProfile({ ...example(), crosshair: junk })).not.toThrow())
  // 2026-09-21: a Profile no longer manages the enemy. The App no longer writes the slot, but a
  // Profile a player already saved has to keep opening, and must not lose anything else on the way.
  it('opens a Profile saved before the enemy slot was removed, and drops only that record', () => {
    const legacy = { ...example(), enemy: ref('../enemies/blue.json') }
    const parsed = parseTrainingProfile(legacy)
    expect(parsed).toEqual(parseTrainingProfile(example()))
    expect(Object.hasOwn(parsed, 'enemy')).toBe(false)
    expect(Object.hasOwn(JSON.parse(serializeTrainingProfile(parsed)), 'enemy')).toBe(false)
  })
  // The old field is discarded without being validated, so a record that can no longer reach
  // anything is never the reason a Profile refuses to load.
  it.each([{ fullBright: true }, { roughness: NaN }, { metallic: 1.01 }, { bodyColor: '#fff' }, { unknown: 0 }, 'not an object', 42, null])(
    'opens an old Profile whose enemy record was malformed %#',
    junk => expect(() => parseTrainingProfile({ ...example(), enemy: junk })).not.toThrow())
  it('rejects missing fields, wrong asset extensions, and non-JSON array properties', () => {
    const { scheme: _scheme, ...missing } = example()
    expect(() => parseTrainingProfile(missing)).toThrow()
    expect(() => parseTrainingProfile({ ...example(), audio: { kill: ['a.mp3'] } })).toThrow()
    const files = [ref('a.wav')]
    Object.defineProperty(files, 'hidden', { value: () => 1 })
    expect(() => parseTrainingProfile({ ...example(), audio: { kill: files } })).toThrow()
  })
  it('copies every component for parse, rename and duplicate', () => {
    const input = example()
    const parsed = parseTrainingProfile(input)
    const renamed = renameTrainingProfile(parsed, 'Second')
    const duplicate = duplicateTrainingProfile(parsed, 'copy', 'Copy')
    input.audio.kill.push(ref('original.wav'))
    parsed.audio!.kill!.push(ref('parsed.wav'))
    expect(renamed.audio!.kill).toEqual([ref('a.WAV'), ref('b.ogg'), ref('a.WAV')])
    expect([renamed.id, renamed.name, duplicate.id, duplicate.name]).toEqual(['warmup-1', 'Second', 'copy', 'Copy'])
  })
})

describe('ordinary asset path resolution', () => {
  it.each([
    ['/profiles/a.json', '../assets/中文 x.png', '/assets/中文 x.png'],
    ['C:\\profiles\\a.json', '..\\assets\\中文 x.png', 'C:\\assets\\中文 x.png'],
    ['C:\\profiles\\a.json', 'D:\\assets\\x.png', 'D:\\assets\\x.png'],
    ['C:\\profiles\\a.json', '\\\\server\\share\\x.png', '\\\\server\\share\\x.png'],
    ['\\\\server\\share\\profiles\\a.json', '..\\x.png', '\\\\server\\share\\x.png'],
    ['profiles/a.json', '../x.png', 'x.png'],
  ])('resolves %s + %s', (profile, asset, expected) => expect(resolveProfileAssetPath(profile, asset)).toBe(expected))
  it('rejects URI and device path references', () => {
    expect(() => resolveProfileAssetPath('/p/a.json', 'https://host/x.png')).toThrow()
    expect(() => resolveProfileAssetPath('C:\\p\\a.json', '\\\\?\\C:\\x.png')).toThrow()
  })
})
