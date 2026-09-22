import { expect, it, vi } from 'vitest'
import { createAudioEditor } from '../../../src/profiles/audio/editor'
import type { PreviewMedia } from '../../../src/profiles/audio/preview'

function setup() {
  const media: PreviewMedia = { src: '', preload: '', onended: null, onerror: null, play: vi.fn(async () => {}), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() }
  const readFile = vi.fn(async (_file: string, _signal: AbortSignal) => new Blob(['audio']))
  const onAudioChange = vi.fn()
  const editor = createAudioEditor({ audio: { kill: ['a.wav', 'b.ogg', 'a.wav'] }, readFile, createMedia: () => media, createObjectURL: () => 'blob:test', revokeObjectURL: vi.fn(), onAudioChange })
  return { editor, media, readFile, onAudioChange }
}
it('auditions an exact list entry and stops on replacement before announcing the new selection', async () => {
  const h = setup()
  await h.editor.play('kill', 1)
  expect(h.readFile).toHaveBeenCalledWith('b.ogg', expect.any(AbortSignal))
  h.editor.replaceFile('kill', 1, 'c.wav')
  expect(h.media.pause).toHaveBeenCalledOnce()
  expect(h.editor.getPreviewState().status).toBe('idle')
  expect(h.onAudioChange).toHaveBeenCalledWith({ kill: ['a.wav', 'c.wav', 'a.wav'] })
  await h.editor.play('kill', 1)
  expect(h.readFile).toHaveBeenLastCalledWith('c.wav', expect.any(AbortSignal))
  h.editor.dispose()
})
it('detaches exposed data and supports keep, clear, move and remove', () => {
  const h = setup()
  h.editor.moveFile('kill', 1, 0)
  expect(h.editor.getAudio()).toEqual({ kill: ['b.ogg', 'a.wav', 'a.wav'] })
  h.editor.removeFile('kill', 2)
  h.editor.replaceEvent('spawn', [])
  h.editor.keepEvent('kill')
  expect(h.editor.getAudio()).toEqual({ spawn: [] })
  h.editor.setAudio(null)
  expect(h.editor.getAudio()).toBeNull()
  h.editor.setAudio({ kill: ['a.wav'] })
  const snapshot = h.editor.getAudio()!
  snapshot.kill = []
  expect(h.editor.getAudio()).toEqual({ kill: ['a.wav'] })
  h.editor.dispose()
})
it('invalid replacement preserves the last good selection and active audition', async () => {
  const h = setup()
  await h.editor.play('kill', 0)
  expect(() => h.editor.replaceFile('kill', 0, 'bad.mp3')).toThrow()
  expect(h.editor.getPreviewState().status).toBe('playing')
  expect(h.editor.getAudio()?.kill?.[0]).toBe('a.wav')
  expect(h.onAudioChange).not.toHaveBeenCalled()
  h.editor.dispose()
})
it('does not silently play a different item for an invalid event or index', async () => {
  const h = setup()
  await expect(h.editor.play('spawn', 0)).rejects.toThrow()
  await expect(h.editor.play('kill', -1)).rejects.toThrow()
  expect(h.readFile).not.toHaveBeenCalled()
  h.editor.dispose()
})
it('rejects edits after disposal and prevents new playback', async () => {
  const h = setup()
  h.editor.dispose()
  expect(() => h.editor.setAudio(null)).toThrow()
  await expect(h.editor.play('kill', 0)).rejects.toThrow()
  expect(h.readFile).not.toHaveBeenCalled()
})
