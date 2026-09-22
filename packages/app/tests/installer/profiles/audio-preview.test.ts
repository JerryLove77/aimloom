import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioPreview, type PreviewMedia } from '../../../src/profiles/audio/preview'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(readFile = vi.fn(async (_file: string, _signal: AbortSignal) => new Blob(['audio']))) {
  const players: PreviewMedia[] = []
  const createMedia = vi.fn(() => {
    const media: PreviewMedia = { src: '', preload: '', onended: null, onerror: null, play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() }
    players.push(media)
    return media
  })
  const createObjectURL = vi.fn(() => `blob:audio-${players.length}`)
  const revokeObjectURL = vi.fn()
  const preview = createAudioPreview({ readFile, createMedia, createObjectURL, revokeObjectURL, timeoutMs: 1000 })
  return { preview, readFile, createMedia, createObjectURL, revokeObjectURL, players }
}
afterEach(() => vi.useRealTimers())

describe('audio audition lifecycle', () => {
  it('loads only after a request, plays and releases resources on natural end', async () => {
    const h = setup()
    expect(h.readFile).not.toHaveBeenCalled()
    expect(h.preview.getState()).toEqual({ status: 'idle' })
    const updates: string[] = []
    h.preview.subscribe(state => updates.push(state.status))
    await h.preview.play('a.wav')
    expect(updates).toEqual(['loading', 'playing'])
    expect(h.players[0]!.play).toHaveBeenCalledOnce()
    h.players[0]!.onended!(new Event('ended'))
    expect(h.preview.getState()).toEqual({ status: 'idle' })
    expect(h.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('stops playback, unloads the media, and permits replay', async () => {
    const h = setup()
    await h.preview.play('a.ogg')
    h.preview.stop()
    expect(h.players[0]!.pause).toHaveBeenCalledOnce()
    expect(h.players[0]!.removeAttribute).toHaveBeenCalledWith('src')
    expect(h.players[0]!.load).toHaveBeenCalledOnce()
    expect(h.preview.getState().status).toBe('idle')
    await h.preview.play('a.ogg')
    expect(h.readFile).toHaveBeenCalledTimes(2)
    h.preview.dispose()
    expect(h.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
  it('stops the previous sound before starting another', async () => {
    const h = setup()
    await h.preview.play('a.wav')
    await h.preview.play('b.wav')
    expect(h.players[0]!.pause).toHaveBeenCalledOnce()
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:audio-0')
    expect(h.preview.getState()).toEqual({ status: 'playing', file: 'b.wav' })
    h.preview.dispose()
  })
  it('aborts an old read and ignores its result even if the reader ignores abort', async () => {
    const first = deferred<Blob>()
    const read = vi.fn(async (file: string, _signal: AbortSignal) => file === 'a.wav' ? first.promise : new Blob(['b']))
    const h = setup(read)
    const old = h.preview.play('a.wav')
    await h.preview.play('b.wav')
    expect(read.mock.calls[0]![1].aborted).toBe(true)
    first.resolve(new Blob(['a']))
    await old
    expect(h.createObjectURL).toHaveBeenCalledOnce()
    expect(h.preview.getState()).toEqual({ status: 'playing', file: 'b.wav' })
    h.preview.dispose()
  })
  it('ignores a superseded read failure', async () => {
    const first = deferred<Blob>()
    const h = setup(vi.fn(async (file: string, _signal: AbortSignal) => file === 'a.wav' ? first.promise : new Blob(['b'])))
    const old = h.preview.play('a.wav')
    await h.preview.play('b.wav')
    first.reject(new Error('missing'))
    await old
    expect(h.preview.getState()).toEqual({ status: 'playing', file: 'b.wav' })
    h.preview.dispose()
  })
  it('stops a pending read without ever creating a URL', async () => {
    const pending = deferred<Blob>()
    const h = setup(vi.fn(async (_file: string, _signal: AbortSignal) => pending.promise))
    const playing = h.preview.play('a.wav')
    h.preview.stop()
    pending.resolve(new Blob(['a']))
    await playing
    expect(h.createObjectURL).not.toHaveBeenCalled()
    expect(h.preview.getState().status).toBe('idle')
  })
  it('ignores a late play promise and late events from the previous player', async () => {
    const pending = deferred<void>()
    const h = setup()
    h.createMedia.mockImplementationOnce(() => {
      const media: PreviewMedia = { src: '', preload: '', onended: null, onerror: null, play: () => pending.promise, pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() }
      h.players.push(media)
      return media
    })
    const old = h.preview.play('a.wav')
    await vi.waitFor(() => expect(h.players).toHaveLength(1))
    const oldEnd = h.players[0]!.onended!
    const oldError = h.players[0]!.onerror!
    await h.preview.play('b.wav')
    pending.reject(new Error('late'))
    await old
    oldEnd(new Event('ended'))
    oldError(new Event('error'))
    expect(h.preview.getState()).toEqual({ status: 'playing', file: 'b.wav' })
    h.preview.dispose()
  })
  it('reports missing files and permits a corrected retry', async () => {
    const h = setup()
    h.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    await h.preview.play('missing.wav')
    expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'read', file: 'missing.wav' })
    expect(h.createObjectURL).not.toHaveBeenCalled()
    await h.preview.play('found.wav')
    expect(h.preview.getState().status).toBe('playing')
    h.preview.dispose()
  })
  it('rejects unsupported extensions before reading', async () => {
    const h = setup()
    await h.preview.play('a.mp3')
    expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'format' })
    expect(h.readFile).not.toHaveBeenCalled()
  })
  it('rejects empty audio', async () => {
    const h = setup(vi.fn(async (_file: string, _signal: AbortSignal) => new Blob([])))
    await h.preview.play('a.wav')
    expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'decode' })
    expect(h.createObjectURL).not.toHaveBeenCalled()
  })
  it('handles decoding errors and cleans up once', async () => {
    const h = setup()
    await h.preview.play('broken.wav')
    h.players[0]!.onerror!(new Event('error'))
    expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'decode', file: 'broken.wav' })
    h.preview.stop()
    expect(h.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('reports blocked playback with a user-action hint and releases the URL', async () => {
    const h = setup()
    h.createMedia.mockImplementationOnce(() => {
      const media: PreviewMedia = { src: '', preload: '', onended: null, onerror: null, play: vi.fn(async () => { throw new DOMException('blocked', 'NotAllowedError') }), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() }
      h.players.push(media)
      return media
    })
    await h.preview.play('a.wav')
    expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'blocked' })
    expect(h.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it('times out hung reads and ignores their eventual result', async () => {
    vi.useFakeTimers()
    const pending = deferred<Blob>()
    const h = setup(vi.fn(async (_file: string, _signal: AbortSignal) => pending.promise))
    const playing = h.preview.play('a.wav')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'timeout' })
    expect(h.readFile.mock.calls[0]![1].aborted).toBe(true)
    pending.resolve(new Blob(['a']))
    await playing
    expect(h.createObjectURL).not.toHaveBeenCalled()
  })
  it('unsubscribes and permanently disposes safely during an async load', async () => {
    const pending = deferred<Blob>()
    const h = setup(vi.fn(async (_file: string, _signal: AbortSignal) => pending.promise))
    const listener = vi.fn()
    const unsubscribe = h.preview.subscribe(listener)
    const playing = h.preview.play('a.wav')
    unsubscribe()
    h.preview.dispose()
    h.preview.dispose()
    pending.resolve(new Blob(['a']))
    await playing
    await h.preview.play('b.wav')
    expect(h.preview.getState().status).toBe('idle')
    expect(h.readFile).toHaveBeenCalledOnce()
    expect(h.createObjectURL).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledOnce()
  })
})

it('does not start a read when a subscriber stops the loading request', async () => {
  const h = setup()
  h.preview.subscribe(state => { if (state.status === 'loading') h.preview.stop() })
  await h.preview.play('a.wav')
  expect(h.readFile).not.toHaveBeenCalled()
  expect(h.preview.getState()).toEqual({ status: 'idle' })
  h.preview.dispose()
})
it('cannot restart playback through an idle notification during disposal', async () => {
  const h = setup()
  await h.preview.play('a.wav')
  h.preview.subscribe(state => { if (state.status === 'idle') void h.preview.play('b.wav') })
  h.preview.dispose()
  await Promise.resolve()
  expect(h.readFile).toHaveBeenCalledOnce()
  expect(h.preview.getState()).toEqual({ status: 'idle' })
})
it('cleans up a hung play promise on timeout', async () => {
  vi.useFakeTimers()
  const h = setup()
  const pending = deferred<void>()
  h.createMedia.mockImplementationOnce(() => {
    const media: PreviewMedia = { src: '', preload: '', onended: null, onerror: null, play: () => pending.promise, pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() }
    h.players.push(media)
    return media
  })
  const playing = h.preview.play('a.wav')
  await vi.advanceTimersByTimeAsync(1000)
  await playing
  expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'timeout' })
  expect(h.players[0]!.pause).toHaveBeenCalledOnce()
  expect(h.revokeObjectURL).toHaveBeenCalledOnce()
  pending.resolve()
})
it('releases a URL if media construction fails', async () => {
  const h = setup()
  h.createMedia.mockImplementationOnce(() => { throw new Error('unavailable') })
  await h.preview.play('a.wav')
  expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'decode' })
  expect(h.revokeObjectURL).toHaveBeenCalledOnce()
})

it('reports a synchronously thrown reader failure without an unhandled cancellation rejection', async () => {
  const h = setup(vi.fn((_file: string, _signal: AbortSignal): Promise<Blob> => { throw new Error('bridge unavailable') }))
  await h.preview.play('a.wav')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(h.preview.getState()).toMatchObject({ status: 'error', code: 'read' })
  expect(h.createObjectURL).not.toHaveBeenCalled()
})
