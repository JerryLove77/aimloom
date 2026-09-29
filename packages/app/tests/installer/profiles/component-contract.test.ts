import { describe, expect, it } from 'vitest'
import { createTrainingProfile, parseTrainingProfile, serializeTrainingProfile, deserializeTrainingProfile, duplicateTrainingProfile } from '../../../src/profiles/model'

const ref = (path: string) => ({ name: path.split(/[\\/]/).pop()!, path })
const fileProfile = () => ({ ...createTrainingProfile('files', 'Files'), scheme: ref('themes/theme.json') })

describe('component files in Profile', () => {
  it('round-trips six audio events and only references for the other components', () => {
    const input = { ...fileProfile(), scheme: ref('themes/next.json'), audio: { kill: [ref('a.wav'), ref('a.wav')], spawn: [], mbsGood: [ref('good.ogg')], mbsOkay: [ref('okay.wav')], mbsBad: [], mbsChangeNow: [ref('change.wav')] } }
    const reopened = deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(input)))
    expect(reopened).toEqual(input)
    expect(reopened.audio?.mbsGood).toEqual([ref('good.ogg')])
    expect(duplicateTrainingProfile(reopened, 'copy', 'Copy').scheme).toEqual(ref('themes/next.json'))
  })
  it('rejects embedded component settings rather than silently storing or dropping them', () => {
    expect(() => parseTrainingProfile({ ...createTrainingProfile('empty', 'Empty'), scheme: { ...ref('theme.json'), sourceCode: 'code' } })).toThrow()
  })
  it('preserves selected names and paths without embedding settings', () => {
    const selected = { ...fileProfile(), audio: { mbsGood: [{ name: '成功提示', path: 'good.wav' }] } }
    expect(deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(selected)))).toEqual(selected)
  })
})
