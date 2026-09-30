import { describe, expect, it } from 'vitest'
import { parseTrainingProfile, serializeTrainingProfile, deserializeTrainingProfile, duplicateTrainingProfile } from '../../../src/profiles/model'
import { completeAudio, ref, v2 } from './v2'

describe('component files in Profile', () => {
  it('round-trips six audio events and only a reference for the theme', () => {
    const input = v2('files', 'Files', {
      theme: ref('themes/next.json'),
      audio: completeAudio({ kill: [ref('a.wav'), ref('a.wav')], spawn: [], mbsGood: [ref('good.ogg')], mbsOkay: [ref('okay.wav')], mbsBad: [ref('bad.wav')], mbsChangeNow: [ref('change.wav')] }),
    })
    const reopened = deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(input)))
    expect(reopened).toEqual(input)
    expect(reopened.audio.mbsGood).toEqual([ref('good.ogg')])
    expect(duplicateTrainingProfile(reopened, 'copy', 'Copy').theme).toEqual(ref('themes/next.json'))
  })
  it('rejects embedded component settings rather than silently storing or dropping them', () => {
    expect(() => parseTrainingProfile(v2('empty', 'Empty', { theme: { ...ref('theme.json'), sourceCode: 'code' } as never }))).toThrow()
  })
  it('preserves selected names and paths without embedding settings', () => {
    const selected = v2('files', 'Files', { audio: completeAudio({ mbsGood: [{ name: '成功提示', path: 'good.wav' }] }) })
    expect(deserializeTrainingProfile(serializeTrainingProfile(parseTrainingProfile(selected)))).toEqual(selected)
  })
})
