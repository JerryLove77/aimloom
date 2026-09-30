import { describe, expect, it } from 'vitest'
import { createProfileDraft, deserializeTrainingProfile, duplicateTrainingProfile, isComplete, parseProfileDraft, parseTrainingProfile, renameTrainingProfile, resolveProfileAssetPath, serializeTrainingProfile } from '../../../src/profiles/model'
import { completeAudio, ref, v2 } from './v2'

const example = () => v2('warmup-1', '热身', {
  theme: ref('../方案/main.JSON'),
  audio: completeAudio({ kill: [ref('a.WAV'), ref('b.ogg'), ref('a.WAV')], spawn: [ref('s.wav')] }),
})

describe('TrainingProfile JSON (v2, a complete snapshot)', () => {
  it('round trips all choices while preserving audio order and duplicates', () => {
    const value = example()
    expect(deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(value)))).toEqual(value)
  })
  it('keeps kill and spawn empty (no sound) and requires every event', () => {
    const parsed = parseTrainingProfile(example())
    expect(parsed.audio.spawn).toEqual([ref('s.wav')])
    expect(parseTrainingProfile({ ...example(), audio: completeAudio() }).audio).toMatchObject({ kill: [], spawn: [] })
  })
  it('writes keys in one order', () => {
    expect(Object.keys(parseTrainingProfile({ audio: completeAudio(), theme: ref('t.json'), name: 'N', id: 'n', schemaVersion: 2 }))).toEqual(['schemaVersion', 'id', 'name', 'theme', 'audio'])
  })
  it.each([
    null, [], new Date(), { ...example(), extra: 1 },
    { ...example(), theme: undefined }, { ...example(), theme: null }, { ...example(), name: '  ' }, { ...example(), name: 'a\nb' }, { ...example(), name: 'x'.repeat(129) },
    { ...example(), audio: { ...completeAudio(), hit: [] } }, { ...example(), audio: completeAudio({ kill: 'a.wav' as never }) }, { ...example(), audio: completeAudio({ kill: Array(65).fill('a.wav') }) },
    { ...example(), theme: { name: 'a.json', path: 'a.json', extra: true } },
    Object.assign(Object.create({}), example()),
  ])('rejects malformed profile %#', value => expect(() => parseTrainingProfile(value)).toThrow())
  it('refuses version 1 and any other version, with the version message', () => {
    for (const schemaVersion of [1, 3, '2', undefined]) {
      expect(() => parseTrainingProfile({ ...example(), schemaVersion })).toThrow(/格式版本/)
    }
    // The v1 shape itself: `scheme`, nullable audio.
    expect(() => parseTrainingProfile({ schemaVersion: 1, id: 'old', name: '旧', scheme: null, audio: null })).toThrow()
  })
  it('refuses the old `scheme` field, and the long-gone `crosshair` and `enemy` records', () => {
    const { theme, ...rest } = example()
    expect(() => parseTrainingProfile({ ...rest, scheme: theme })).toThrow()
    expect(() => parseTrainingProfile({ ...example(), scheme: theme })).toThrow()
    expect(() => parseTrainingProfile({ ...example(), crosshair: ref('red.png') })).toThrow()
    expect(() => parseTrainingProfile({ ...example(), enemy: ref('blue.json') })).toThrow()
  })
  it.each(['mbsGood', 'mbsOkay', 'mbsBad', 'mbsChangeNow'] as const)('needs exactly one sound for %s', event => {
    const two = { ...example(), audio: completeAudio({ [event]: [ref('a.wav'), ref('b.wav')] }) }
    const none = { ...example(), audio: completeAudio({ [event]: [] }) }
    expect(() => parseTrainingProfile(two)).toThrow(/恰好选一个/)
    expect(() => parseTrainingProfile(none)).toThrow(/恰好选一个/)
    expect(() => parseProfileDraft(two)).toThrow()
    expect(() => parseProfileDraft(none)).toThrow()
  })
  it.each(['kill', 'spawn', 'mbsGood', 'mbsOkay', 'mbsBad', 'mbsChangeNow'] as const)('refuses a saved Profile missing %s', event => {
    const { [event]: _gone, ...audio } = completeAudio()
    expect(() => parseTrainingProfile({ ...example(), audio })).toThrow()
    expect(() => parseTrainingProfile({ ...example(), audio: null })).toThrow()
  })
  it.each(['../bad', 'UPPER', '', 'con', 'com1', 'lpt9', 'a'.repeat(65)])('rejects unsafe id %s', id => {
    expect(() => createProfileDraft(id, 'Name')).toThrow()
  })
  it.each(['https://host/a.json', 'data:a.json', 'C:relative.json', 'a.json?x', 'a.json#x', 'a.png', 'a\n.json', ' ', 'x'.repeat(4097) + '.json'])('rejects invalid theme reference %#', file => {
    expect(() => parseTrainingProfile({ ...example(), theme: ref(file) })).toThrow()
  })
  it('enforces the UTF-8 byte limit on parsed and serialized input', () => {
    const big = { ...example(), audio: completeAudio({ kill: Array(64).fill(ref('界'.repeat(1400) + '.wav')) }) }
    expect(() => parseTrainingProfile(big)).toThrow()
    expect(() => serializeTrainingProfile(big as never)).toThrow()
    expect(() => deserializeTrainingProfile(' '.repeat(262145))).toThrow()
    expect(() => deserializeTrainingProfile('{bad')).toThrow()
  })
  it('rejects wrong asset extensions and non-JSON array properties', () => {
    expect(() => parseTrainingProfile({ ...example(), audio: completeAudio({ kill: ['a.mp3' as never] }) })).toThrow()
    const files = [ref('a.wav')]
    Object.defineProperty(files, 'hidden', { value: () => 1 })
    expect(() => parseTrainingProfile({ ...example(), audio: completeAudio({ kill: files }) })).toThrow()
  })
  it('copies every component for parse, rename and duplicate', () => {
    const input = example()
    const parsed = parseTrainingProfile(input)
    const renamed = renameTrainingProfile(parsed, 'Second')
    const duplicate = duplicateTrainingProfile(parsed, 'copy', 'Copy')
    input.audio.kill!.push(ref('original.wav'))
    parsed.audio.kill!.push(ref('parsed.wav'))
    expect(renamed.audio.kill).toEqual([ref('a.WAV'), ref('b.ogg'), ref('a.WAV')])
    expect([renamed.id, renamed.name, duplicate.id, duplicate.name]).toEqual(['warmup-1', 'Second', 'copy', 'Copy'])
    expect(duplicate.theme).toEqual(ref('../方案/main.JSON'))
  })
})

describe('a Profile draft', () => {
  it('starts empty: no theme, no events chosen, and is not complete', () => {
    const draft = createProfileDraft('new', 'New')
    expect(draft).toEqual({ schemaVersion: 2, id: 'new', name: 'New', theme: null, audio: {} })
    expect(isComplete(draft)).toBe(false)
  })
  it('starts from what it is given', () => {
    const draft = createProfileDraft('new', 'New', { theme: ref('t.json'), audio: completeAudio({ kill: [ref('k.wav')] }) })
    expect(draft.theme).toEqual(ref('t.json'))
    expect(draft.audio.kill).toEqual([ref('k.wav')])
    expect(isComplete(draft)).toBe(true)
  })
  it('allows a missing theme and missing events, but no other rule is relaxed', () => {
    expect(parseProfileDraft({ ...example(), theme: null, audio: { kill: [] } })).toMatchObject({ theme: null, audio: { kill: [] } })
    expect(() => parseProfileDraft({ ...example(), schemaVersion: 1 })).toThrow()
    expect(() => parseProfileDraft({ ...example(), name: '' })).toThrow()
    expect(() => parseProfileDraft({ ...example(), audio: { hit: [] } })).toThrow()
    expect(() => parseProfileDraft({ ...example(), scheme: null })).toThrow()
  })
  it('is complete only with a theme and all six events; serializing an incomplete one throws', () => {
    const base = createProfileDraft('d', 'D', { theme: ref('t.json'), audio: completeAudio() })
    expect(isComplete(base)).toBe(true)
    expect(isComplete({ ...base, theme: null })).toBe(false)
    const { mbsBad: _gone, ...audio } = base.audio
    expect(isComplete({ ...base, audio })).toBe(false)
    expect(() => serializeTrainingProfile({ ...base, theme: null })).toThrow(/背景和 6 个音效事件都要选好/)
    expect(() => parseTrainingProfile({ ...base, audio })).toThrow()
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
