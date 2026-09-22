import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createTrainingProfile, parseTrainingProfile, serializeTrainingProfile, deserializeTrainingProfile, duplicateTrainingProfile } from '../../../src/profiles/model'
import { replaceProfileAudio, parseAudioSelection } from '../../../src/profiles/audio/model'
import { replaceScheme, parseScheme } from '../../../../core/src/scheme/index'
import { composeSchemeEnemyPatch } from '../../../../core/src/enemy/index'
import { parseTheme } from '../../../../core/src/theme/parse'

const themeBytes = () => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../KVK Settings 2025/Themes/Default.json'))
const ref = (path: string) => ({ name: path.split(/[\\/]/).pop()!, path })
const fileProfile = () => ({ ...createTrainingProfile('files', 'Files'), scheme: ref('themes/theme.json') })

describe('component files in Profile', () => {
  it('round-trips six audio events and only references for the other components', () => {
    const input = replaceProfileAudio(replaceScheme(fileProfile(), ref('themes/next.json')), { kill: ['a.wav', 'a.wav'], spawn: [], mbsGood: ['good.ogg'], mbsOkay: ['okay.wav'], mbsBad: [], mbsChangeNow: ['change.wav'] })
    const reopened = deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(input)))
    expect(reopened).toEqual(input)
    expect(reopened.audio?.mbsGood).toEqual([ref('good.ogg')])
    expect(duplicateTrainingProfile(reopened, 'copy', 'Copy').scheme).toEqual(ref('themes/next.json'))
  })
  it('rejects embedded component settings rather than silently storing or dropping them', () => {
    const document = parseScheme(themeBytes())
    expect(() => replaceScheme(fileProfile(), { document } as never)).toThrow()
    expect(() => parseTrainingProfile({ ...createTrainingProfile('empty', 'Empty'), scheme: { ...ref('theme.json'), sourceCode: 'code' } })).toThrow()
  })
  it('preserves selected names and paths without embedding settings', () => {
    const selected = { ...fileProfile(), audio: { mbsGood: [{ name: '成功提示', path: 'good.wav' }] } }
    expect(deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(selected)))).toEqual(selected)
  })
  it('keeps editor audio choices within persistable file limits', () => {
    expect(() => parseAudioSelection({ mbsGood: Array(65).fill('good.wav') })).toThrow()
    expect(() => parseAudioSelection({ kill: ['x'.repeat(4096) + '.wav'] })).toThrow()
    expect(() => parseAudioSelection({ kill: ['//?/C:/audio.wav'] })).toThrow()
  })
})

describe('resolved scheme/enemy composition', () => {
  it('uses the new scheme document and changes only explicit enemy fields', () => {
    const document = parseScheme(themeBytes())
    const before = structuredClone(document)
    const patch = composeSchemeEnemyPatch(document, { bodyColor: '#ffffff', overrideBody: false })
    expect(patch.vectorSettings?.['EVectorSettingId::EnemyBodyColor']).toEqual({ x: 1, y: 1, z: 1 })
    expect(patch.booleanSettings?.['EBooleanSettingId::OverrideEnemyBodyColor']).toBe(false)
    expect(Object.keys(patch.floatSettings ?? {}).filter(key => key.includes('Team'))).toEqual([])
    expect(document).toEqual(before)
  })
  it('preserves teammate and enemy values for legacy theme callers with no enemy override', () => {
    const parsed = parseTheme(themeBytes(), 'legacy')
    if (!parsed.ok) throw new Error(parsed.error)
    const patch = composeSchemeEnemyPatch(parsed.theme, null)
    const keys = Object.values(patch).flatMap(section => Object.keys(section ?? {}))
    expect(keys.filter(key => /Enemy|Team/.test(key))).toEqual([])
  })
})
