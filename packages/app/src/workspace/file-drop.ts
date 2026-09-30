import { useEffect, useRef, useState } from 'react'
import { useMsg, type Msg } from '../i18n'
import type { WorkspaceSection } from './WorkspaceShell'

/** A file dragged in from the operating system. `over` events are dropped at the source. */
export type FileDropEvent = { type: 'enter' | 'drop'; paths: string[] } | { type: 'leave' }
export interface FileDropSource { subscribe(listener: (event: FileDropEvent) => void): () => void }
export interface FileDropHint { accepted: boolean; text: string }

/** For surfaces that take no drops: tests, and any host without a drop source. */
export const noFileDrops: FileDropSource = { subscribe: () => () => {} }

/** A source driven by hand: the browser demo and the tests. */
export function createManualFileDropSource(): FileDropSource & { emit(event: FileDropEvent): void } {
  const listeners = new Set<(event: FileDropEvent) => void>()
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    emit(event) { [...listeners].forEach(listener => listener(event)) },
  }
}

/**
 * Explorer drops, with real paths. Tauri intercepts them on Windows (HTML5 drop never fires
 * there), so this is the only route. The module is imported lazily because it reads Tauri's
 * internals and would throw in a browser. One listener serves the whole app for its lifetime.
 */
export function createNativeFileDropSource(): FileDropSource {
  const source = createManualFileDropSource()
  void import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(event => {
      const payload = event.payload
      if (payload.type === 'enter' || payload.type === 'drop') source.emit({ type: payload.type, paths: payload.paths })
      else if (payload.type === 'leave') source.emit({ type: 'leave' })
    }))
    .catch(error => console.warn('Could not listen for dropped files; the "Choose a file" button still works.', error))
  return { subscribe: source.subscribe }
}

type FileKind = 'theme' | 'sound' | 'crosshair'
/** A section takes one kind of file; Explore takes a config pack folder, which opens Quick import. */
type Accepts = FileKind | 'pack'
// The enemy skin is chosen from the game's own fixed catalog, never from a dropped file.
const ACCEPTS: Record<WorkspaceSection, Accepts | null> = { profile: null, scheme: 'theme', enemy: null, audio: 'sound', crosshair: 'crosshair', explore: 'pack' }
const BY_EXTENSION: Record<string, FileKind> = { '.json': 'theme', '.wav': 'sound', '.ogg': 'sound', '.png': 'crosshair' }
const WHERE: Record<FileKind, Msg> = {
  theme: { key: 'import.drop.whereTheme' },
  sound: { key: 'import.drop.whereSound' },
  crosshair: { key: 'import.drop.whereCrosshair' },
}
const READY: Record<Accepts, Msg> = {
  theme: { key: 'import.drop.readyTheme' },
  sound: { key: 'import.drop.readySound' },
  crosshair: { key: 'import.drop.readyCrosshair' },
  pack: { key: 'import.drop.readyPack' },
}

/**
 * Decides what the active section does with a drop. Only its own kind of file is accepted.
 * Explore cannot tell a folder from a file by its path, so it takes anything that is not a
 * known file kind or a ZIP; Quick import's catalog check is what refuses a path that is not a
 * config pack folder. Quick import reads folders only, so a ZIP is refused everywhere.
 */
export function routeDrop(section: WorkspaceSection, paths: string[]): { ok: true; path: string } | { ok: false; message: Msg } {
  if (paths.length === 0) return { ok: false, message: { key: 'import.drop.empty' } }
  if (paths.length > 1) return { ok: false, message: { key: 'import.drop.tooMany' } }
  const path = paths[0]!
  const dot = path.lastIndexOf('.')
  const extension = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  if (extension === '.zip') return { ok: false, message: { key: 'import.drop.unzipFirst' } }
  const kind = BY_EXTENSION[extension]
  if (section === 'explore') return kind ? { ok: false, message: WHERE[kind] } : { ok: true, path }
  if (!kind) return { ok: false, message: { key: 'import.drop.unsupported' } }
  return ACCEPTS[section] === kind ? { ok: true, path } : { ok: false, message: WHERE[kind] }
}

/**
 * Wires a section to the drop source. It answers while the file still hovers (the hint says
 * whether the drop will be accepted), hands an accepted drop to `onFile`, and reports a refusal
 * through `onRefused`. Inactive sections ignore everything; a busy one refuses the drop.
 *
 * The hint text and refusal message are rendered to the current language here, so `onFile` /
 * `onRefused` and `FileDropHint` stay plain strings for every (not yet migrated) caller.
 */
export function useFileDrop(source: FileDropSource, options: {
  section: WorkspaceSection; active: boolean; busy: boolean
  onFile(path: string): void; onRefused(message: string): void
}): FileDropHint | null {
  const msg = useMsg()
  const [hint, setHint] = useState<FileDropHint | null>(null)
  const latest = useRef(options)
  latest.current = options
  const { active } = options
  useEffect(() => {
    if (!active) { setHint(null); return }
    return source.subscribe(event => {
      const { section, busy, onFile, onRefused } = latest.current
      if (event.type === 'leave') { setHint(null); return }
      const route = routeDrop(section, event.paths)
      if (event.type === 'enter') {
        const kind = ACCEPTS[section]
        setHint(busy ? { accepted: false, text: msg({ key: 'import.drop.busyHint' }) }
          : route.ok && kind ? { accepted: true, text: msg(READY[kind]) }
          : { accepted: false, text: route.ok ? '' : msg(route.message) })
        return
      }
      setHint(null)
      if (busy) onRefused(msg({ key: 'import.drop.busyRefused' }))
      else if (route.ok) onFile(route.path)
      else onRefused(msg(route.message))
    })
  }, [source, active, msg])
  return hint
}
