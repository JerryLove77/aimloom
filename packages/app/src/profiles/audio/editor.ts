import { t } from '../../i18n'
import { keepAudioEvent, moveAudioFile, parseAudioSelection, removeAudioFile, replaceAudioFile, replaceEventSounds, type AudioEvent, type AudioSelection } from './model'
import { createAudioPreview, type AudioPreviewOptions } from './preview'

export interface AudioEditorOptions extends AudioPreviewOptions {
  audio: AudioSelection
  /** Update the owning Profile draft. Persistence remains an explicit action in its store. */
  onAudioChange?: (audio: AudioSelection) => void
}

/** Headless audio section for the Profile editor. Selection changes always stop the old audition. */
export function createAudioEditor(options: AudioEditorOptions) {
  let audio = parseAudioSelection(options.audio)
  let disposed = false
  const preview = createAudioPreview(options)
  function assertActive() {
    if (disposed) throw new Error(t('zh', 'audio.editor.error.closed'))
  }
  function setAudio(value: unknown) {
    assertActive()
    const next = parseAudioSelection(value)
    audio = next
    preview.stop()
    options.onAudioChange?.(parseAudioSelection(next))
  }
  return {
    getAudio: () => parseAudioSelection(audio),
    setAudio,
    replaceEvent: (event: AudioEvent, files: readonly string[]) => setAudio(replaceEventSounds(audio, event, files)),
    replaceFile: (event: AudioEvent, index: number, file: string) => setAudio(replaceAudioFile(audio, event, index, file)),
    moveFile: (event: AudioEvent, from: number, to: number) => setAudio(moveAudioFile(audio, event, from, to)),
    removeFile: (event: AudioEvent, index: number) => setAudio(removeAudioFile(audio, event, index)),
    keepEvent: (event: AudioEvent) => setAudio(keepAudioEvent(audio, event)),
    async play(event: AudioEvent, index: number) {
      assertActive()
      const files = audio?.[event]
      if (!Number.isInteger(index) || index < 0 || !files || index >= files.length) {
        throw new Error(t('zh', 'audio.editor.error.noSelection'))
      }
      await preview.play(files[index]!)
    },
    stop: preview.stop,
    getPreviewState: preview.getState,
    subscribePreview: preview.subscribe,
    dispose() {
      disposed = true
      preview.dispose()
    },
  }
}
