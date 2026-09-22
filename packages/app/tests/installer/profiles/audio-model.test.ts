import { describe, expect, it } from 'vitest'
import { parseAudioSelection, replaceEventSounds, replaceAudioFile, moveAudioFile, removeAudioFile, keepAudioEvent, replaceProfileAudio, profileAudioPaths } from '../../../src/profiles/audio/model'

describe('Profile audio selection', () => {
  it('round trips keep-all, omitted events, empty lists, order and duplicates', () => {
    for (const audio of [null, {}, { kill: [], spawn: ['assets/b.ogg', 'assets/a.wav', 'assets/b.ogg'] }]) {
      expect(parseAudioSelection(JSON.parse(JSON.stringify(audio)))).toEqual(audio)
    }
  })
  it('retains local paths and extensions without rewriting source names', () => {
    const audio = { kill: ['../sounds/测试.WAV', 'C:\\sounds\\kill.OGG', '/tmp/a.wav'] }
    expect(parseAudioSelection(audio)).toEqual(audio)
    expect(parseAudioSelection(audio)).not.toBe(audio)
    expect(parseAudioSelection(audio)?.kill).not.toBe(audio.kill)
  })
  it.each([undefined, [], '', 1, { unknown: [] }, { kill: null }, { kill: 'a.wav' }, { kill: [''] }, { kill: ['a.mp3'] }, { kill: ['a.ogg.sfk'] }, { kill: ['https://example.com/a.wav'] }, { kill: ['a\u0000.wav'] }])('rejects malformed or unsupported selections: %j', value => {
    expect(() => parseAudioSelection(value)).toThrow()
  })
  it('replaces just one event and isolates caller-owned arrays', () => {
    const old = { kill: ['old.ogg'], spawn: ['spawn.wav'] }
    const files = ['new.ogg', 'new.ogg']
    const updated = replaceEventSounds(old, 'kill', files)
    files.push('later.wav')
    expect(updated).toEqual({ kill: ['new.ogg', 'new.ogg'], spawn: ['spawn.wav'] })
    expect(old.kill).toEqual(['old.ogg'])
    expect(replaceEventSounds(null, 'kill', [])).toEqual({ kill: [] })
  })
  it('replaces, reorders and removes by index without deduplicating', () => {
    const original = { kill: ['a.ogg', 'b.wav', 'a.ogg'] }
    expect(replaceAudioFile(original, 'kill', 1, 'c.wav').kill).toEqual(['a.ogg', 'c.wav', 'a.ogg'])
    expect(moveAudioFile(original, 'kill', 1, 0).kill).toEqual(['b.wav', 'a.ogg', 'a.ogg'])
    expect(removeAudioFile(original, 'kill', 0).kill).toEqual(['b.wav', 'a.ogg'])
    expect(removeAudioFile({ kill: ['a.ogg'] }, 'kill', 0)).toEqual({ kill: [] })
    expect(original.kill).toEqual(['a.ogg', 'b.wav', 'a.ogg'])
  })
  it('does not confuse keeping an event with explicitly clearing it', () => {
    expect(keepAudioEvent({ kill: [], spawn: ['b.wav'] }, 'kill')).toEqual({ spawn: ['b.wav'] })
    expect(keepAudioEvent(null, 'kill')).toBeNull()
    expect(keepAudioEvent({ kill: [] }, 'kill')).toEqual({})
  })
  it('rejects invalid indices rather than replacing or deleting the wrong entry', () => {
    for (const index of [-1, 1, 0.5, NaN]) {
      expect(() => replaceAudioFile({ kill: ['a.wav'] }, 'kill', index, 'b.wav')).toThrow()
      expect(() => removeAudioFile({ kill: ['a.wav'] }, 'kill', index)).toThrow()
      expect(() => moveAudioFile({ kill: ['a.wav'] }, 'kill', 0, index)).toThrow()
    }
    expect(() => removeAudioFile(null, 'kill', 0)).toThrow()
  })
  it('replaces only the audio section and survives a Profile JSON round trip', () => {
    const profile = { schemaVersion: 1, id: 'tracking', name: 'Tracking', scheme: { name: 'theme.json', path: 'theme.json' }, crosshair: null, enemy: { name: 'enemy.json', path: 'enemy.json' }, audio: null }
    const next = replaceProfileAudio(profile, { kill: ['a.wav', 'a.wav'] })
    expect(JSON.parse(JSON.stringify(next))).toEqual({ ...profile, audio: { kill: [{ name: 'a.wav', path: 'a.wav' }, { name: 'a.wav', path: 'a.wav' }] } })
    expect(profileAudioPaths(next.audio)).toEqual({ kill: ['a.wav', 'a.wav'] })
    expect(profile.audio).toBeNull()
    expect(next.scheme).toBe(profile.scheme)
    expect(() => replaceProfileAudio(profile, { kill: ['a.mp3'] })).toThrow()
  })
})
