import { t, type Msg } from '../../i18n'
import { validateAudioFile } from './model'

export type AudioPreviewError = 'format' | 'read' | 'decode' | 'blocked' | 'timeout'
export type AudioPreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' | 'playing'; readonly file: string }
  | { readonly status: 'error'; readonly file: string; readonly code: AudioPreviewError; readonly message: Msg }

export interface PreviewMedia {
  src: string
  preload: string
  onended: ((event: Event) => void) | null
  onerror: ((event: Event | string) => void) | null
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
}

export interface AudioPreviewOptions {
  /** Resolve relative paths against the owning Profile directory through its local file boundary.
   * Return fresh bytes on every request so replacing a source is reflected on the next audition.
   * This reader must not fetch remote URLs or write game files. */
  readFile(file: string, signal: AbortSignal): Promise<Blob>
  createMedia?: () => PreviewMedia
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
  timeoutMs?: number
}

const MESSAGES: Record<AudioPreviewError, Msg> = {
  format: { key: 'audio.error.invalidFile' },
  read: { key: 'audio.preview.error.read' },
  decode: { key: 'audio.preview.error.decode' },
  blocked: { key: 'audio.preview.error.blocked' },
  timeout: { key: 'audio.preview.error.timeout' },
}

/** One controller per editor: only one audition is active at a time. No autoplay or game writes. */
export function createAudioPreview(options: AudioPreviewOptions) {
  const makeMedia = options.createMedia ?? (() => new Audio())
  const makeUrl = options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob))
  const revokeUrl = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url))
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(t('zh', 'audio.preview.error.timeoutConfig'))
  let state: AudioPreviewState = Object.freeze({ status: 'idle' })
  const listeners = new Set<(state: AudioPreviewState) => void>()
  let generation = 0
  let disposed = false
  let request: AbortController | undefined
  let media: PreviewMedia | undefined
  let objectUrl: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function publish(next: AudioPreviewState) {
    state = Object.freeze(next)
    for (const listener of listeners) listener(state)
  }
  function clearTimer() {
    clearTimeout(timer)
    timer = undefined
  }
  function release() {
    clearTimer()
    request?.abort()
    request = undefined
    if (media) {
      media.onended = null
      media.onerror = null
      media.pause()
      media.removeAttribute('src')
      media.load()
      media = undefined
    }
    if (objectUrl !== undefined) {
      revokeUrl(objectUrl)
      objectUrl = undefined
    }
  }
  function stop() {
    generation++
    release()
    if (!disposed) publish({ status: 'idle' })
  }

  async function play(file: string): Promise<void> {
    if (disposed) return
    const own = ++generation
    release()
    const current = () => !disposed && generation === own
    function fail(code: AudioPreviewError) {
      if (!current()) return
      generation++
      release()
      publish({ status: 'error', file, code, message: MESSAGES[code] })
    }
    try { validateAudioFile(file) } catch { fail('format'); return }
    const controller = new AbortController()
    request = controller
    publish({ status: 'loading', file })
    if (!current()) return
    // Resolve the public play request promptly on stop/timeout even if a reader ignores abort.
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
    timer = setTimeout(() => fail('timeout'), timeoutMs)
    let stage: AudioPreviewError = 'read'
    try {
      // Normalize synchronous bridge throws before wiring the cancellation race.
      const read = async () => options.readFile(file, controller.signal)
      const blob = await Promise.race([read(), cancelled])
      if (!current()) return
      stage = 'decode'
      if (blob.size === 0) { fail('decode'); return }
      objectUrl = makeUrl(blob)
      const player = makeMedia()
      media = player
      player.preload = 'auto'
      player.onended = () => { if (current()) stop() }
      player.onerror = () => fail('decode')
      player.src = objectUrl
      await Promise.race([player.play(), cancelled])
      if (!current()) return
      clearTimer()
      publish({ status: 'playing', file })
    } catch (error) {
      if (!current()) return
      const blocked = typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError'
      fail(blocked ? 'blocked' : stage)
    }
  }

  return {
    getState: (): AudioPreviewState => state,
    subscribe(listener: (state: AudioPreviewState) => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    play,
    stop,
    dispose() {
      if (disposed) return
      disposed = true
      generation++
      release()
      publish({ status: 'idle' })
      listeners.clear()
    },
  }
}
