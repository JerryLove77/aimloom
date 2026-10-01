import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useReloadOnChange } from '../section/use-reload-on-change'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { StatusStrip, Tag, Toast, useToast } from '../ui/status'
import { ImportSheet } from '../section/ImportSheet'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { SearchBox } from '../ui/SearchBox'
import { ExploreLink } from '../section/ExploreLink'
import { createAudioController, AUDIO_TAB_KEYS, type AudioBridge } from './controller'
import { createAudioPreview } from './preview'
import { assetMime, type ProfileAssetBridge } from '../bridge/assets'
import { AUDIO_EVENTS, type AudioEvent } from '../bridge/contracts'
import { useLang, useMsg, useT } from '../i18n'
import { LocatePanel } from '../section/LocatePanel'
import { TabRow } from '../ui/TabRow'
import { FavoriteStar } from '../ui/Tiles'
import { useFavorites, type FavoritesStore } from '../section/favorites'
import './audio.css'

const LIST_EVENTS: AudioEvent[] = ['kill', 'spawn']

export function AudioPage({ bridge, assets, favorites, isDemo = false, isActive = true, section, onSelect, fileDrops = noFileDrops, changeStamp = 0 }: {
  bridge: AudioBridge
  assets: ProfileAssetBridge
  /** The starred sounds, listed first; absent: no stars. */
  favorites?: FavoritesStore | undefined
  isDemo?: boolean
  isActive?: boolean
  /** Bumped by the workspace when Quick import or a restore changed the game; the list is read again when this page is next shown. */
  changeStamp?: number
  section: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  /** Files dragged in from outside the app. Only the active section reacts. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const label = (event: AudioEvent) => t(AUDIO_TAB_KEYS[event])
  const summary = (names: string[] | undefined) => (!names || !names.length ? t('audio.unbound') : names.join(t('audio.listSeparator')))
  const controller = useMemo(() => createAudioController(bridge), [bridge])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const preview = useMemo(() => createAudioPreview({ readFile: async path => new Blob([new Uint8Array(await assets.read('audio', path))], { type: assetMime('audio', path) }) }), [assets])
  const audition = useSyncExternalStore(preview.subscribe, preview.getState, preview.getState)
  const { toast, tone, hide, show } = useToast(state.message ? msg(state.message) : null)
  /** The outside file being confirmed in the add sheet. Nothing is written until 添加到游戏. */
  const [importPath, setImportPath] = useState<string | null>(null)
  const addedRow = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const fav = useFavorites(favorites, 'audio', isActive)
  /** Whether the list editor is open, per event. A list of several sounds always shows it. */
  const [advancedOpen, setAdvancedOpen] = useState<Partial<Record<AudioEvent, boolean>>>({})
  // stop(), not dispose(): StrictMode replays mount → cleanup → mount on this same memoized
  // preview, and dispose() is terminal — it would leave every later audition silently dead.
  // stop() releases the media element and the object URL, which is the resource that matters,
  // and useSyncExternalStore drops its own subscription on unmount.
  useEffect(() => () => preview.stop(), [preview])
  useEffect(() => { if (isActive && state.phase === 'idle') void controller.load() }, [isActive, controller, state.phase])
  useReloadOnChange(changeStamp, isActive, state, controller.load)
  // The page always has an event open, so the editor column is never empty.
  useEffect(() => { if (state.phase === 'ready' && !state.event) controller.open('kill') }, [state.phase, state.event, controller])
  // Auditioning is local and temporary: leaving the event or the section stops it.
  useEffect(() => { preview.stop() }, [preview, state.event, isActive])
  useEffect(() => { if (!isActive) setImportPath(null) }, [isActive])
  // Point at the sound that was just added; the list can be long.
  // A sound that was just added must not stay hidden behind an old search.
  useEffect(() => { if (state.lastAdded) setQuery('') }, [state.lastAdded])
  useEffect(() => { if (state.lastAdded) addedRow.current?.scrollIntoView?.({ block: 'nearest' }) }, [state.lastAdded, state.sounds])
  const locked = state.applying || state.unresolved || state.phase === 'locating' || state.phase === 'loading'
  const openImport = (path: string) => { controller.clearImportError(); preview.stop(); setImportPath(path) }
  const dropHint = useFileDrop(fileDrops, {
    section: 'audio', active: isActive, busy: locked, onRefused: show,
    onFile: path => (state.phase === 'ready' ? openImport(path) : show(t('audio.dropNeedsFolder'))),
  })
  if (!isActive) return null
  const event = state.event
  const isList = event !== null && LIST_EVENTS.includes(event)
  const pendingHere = event !== null && state.drafts[event] !== undefined
  const binding = event ? state.bindings?.[event] ?? [] : []
  // One sound per event is the common case, so the list editor stays folded until asked for —
  // except over a list of several sounds, which must never be hidden.
  const advanced = isList && (state.draft.length > 1 || (event !== null && advancedOpen[event] === true))
  const needle = query.trim().toLocaleLowerCase()
  // Favourites first, then the engine's order, before the search narrows the list.
  const sounds = fav.sort(state.sounds, sound => sound.file)
  const shownSounds = needle ? sounds.filter(sound => sound.name.toLocaleLowerCase().includes(needle) || sound.file.toLocaleLowerCase().includes(needle)) : sounds
  const others = controller.pendingEvents().filter(item => item !== event)
  const eventLabel = event ? label(event) : ''
  const playing = (path: string) => audition.status !== 'idle' && audition.file === path
  const play = async (path: string) => {
    if (playing(path)) { preview.stop(); return }
    try { await preview.play(path) } catch { /* the preview publishes its own localized error */ }
  }
  const ready = state.phase === 'ready' && event !== null
  // stop(), never dispose(): the sheet auditions through the page's one preview.
  const closeImport = () => { preview.stop(); setImportPath(null) }
  async function pickImport() {
    const path = await controller.pickImport(lang)
    if (path) openImport(path)
  }
  async function addImport(input: Parameters<typeof controller.importFile>[0]) {
    preview.stop()
    const added = await controller.importFile(input)
    // An unknown result locks the page until 核对结果, which sits behind this sheet.
    if (added || controller.getState().unresolved) setImportPath(null)
    return added
  }
  const overlays = <>
    <Toast message={toast} tone={tone} onDone={hide} />
    {importPath && state.directory ? <ImportSheet key={importPath} kind="sound" sourcePath={importPath} directory={state.directory}
      installed={state.sounds.map(sound => ({ name: sound.name, file: sound.file }))} assets={assets} busy={state.importing} error={state.importError}
      preview={<div className="au-import-audition">
        <Button variant={playing(importPath) ? 'secondary' : 'ghost'} aria-pressed={playing(importPath)} disabled={state.importing} onClick={() => void play(importPath)}>{playing(importPath) ? t('audio.stop.button') : t('audio.play.button')}</Button>
        <span className="ws-note">{t('audio.auditionNote')}</span>
        {audition.status === 'error' ? <p className="pr-error">{msg(audition.message)}</p> : null}
      </div>}
      onAdd={addImport} onClose={closeImport} /> : null}
  </>
  const actions = !ready ? undefined : state.unresolved
    ? <><Button disabled>{t('audio.discard')}</Button><Button variant="primary" onClick={() => void controller.reconcile()}>{t('audio.reconcile')}</Button></>
    : <><Button disabled={!pendingHere || state.applying} onClick={() => controller.discard()}>{t('audio.discard')}</Button>
      <Button variant="primary" disabled={!pendingHere || state.applying} onClick={() => void controller.apply()}>{state.applying ? t('audio.applying') : t('audio.apply')}</Button></>
  const actionNote = state.applying ? t('audio.note.applying')
    : state.unresolved ? t('audio.note.unresolved')
    : others.length ? t('audio.note.withOthers', { label: eventLabel, others: others.map(label).join(t('audio.listSeparator')) })
    : t('audio.note.default', { label: eventLabel })
  return (
    <WorkspaceShell overlays={overlays} dropHint={dropHint} active={section} onSelect={onSelect} isDemo={isDemo}
      eyebrow={t('audio.eyebrow')} title={t('audio.title')} scope={t('audio.scope')}
      actions={actions} actionNote={ready ? actionNote : undefined}>
      {state.unresolved ? <Notice tone="warning"><p>{state.error ? msg(state.error) : t('audio.error.resultUnknown')}</p></Notice>
        : state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}

      {state.phase === 'locating' ? <p role="status">{t('audio.status.locating')}</p> : null}
      {state.phase === 'loading' ? <p role="status">{t('audio.status.loading')}</p> : null}
      <LocatePanel section="audio" phase={state.phase} candidates={state.candidates} locked={locked} controller={controller} />

      {ready && event ? <>
        <StatusStrip current={t('audio.statusStrip.label', { label: eventLabel, value: summary(state.bindings?.[event]) })}
          pending={pendingHere ? t('audio.statusStrip.label', { label: eventLabel, value: summary(state.draft) }) : null}
          aside={<><span>{t('audio.backedUpFirst')}</span><Button variant="ghost" onClick={() => void controller.load()} disabled={locked}>{t('audio.refresh')}</Button></>} />
        {/* One row of event tabs; the selected event's current value is in the strip above. The
            value and a pending edit stay in each tab's accessible name. */}
        <TabRow prefix="au" label={t('audio.tabsAria')} selected={event} locked={locked} onSelect={key => controller.open(key)} tabs={AUDIO_EVENTS.map(key => {
          const pending = state.drafts[key] !== undefined
          return { key, text: label(key), pending,
            accessibleName: t('audio.tab.status', { label: label(key), value: summary(state.bindings?.[key]) }) + (pending ? t('audio.tab.pendingSuffix') : '') }
        })} />
        <div>
          <section className="ws-panel au-editor" aria-label={t('audio.editor.ariaLabel', { label: eventLabel })}>
            <div className="ws-panel-head"><h2>{eventLabel}</h2><span className="ws-note">{isList ? t('audio.editor.list') : t('audio.editor.single')} · {audition.status !== 'idle' ? t('audio.editor.auditionPlaying') : t('audio.editor.auditionHint')}</span></div>
            <p className="ws-note">{advanced ? t('audio.editor.hintAdvanced') : t('audio.editor.hintSimple')}</p>
            <div className="au-toolbar">
              <SearchBox id="audio-search" label={t('audio.search.label')} placeholder={t('audio.search.placeholder')}
                clearLabel={t('audio.clearSearch')} value={query} onChange={setQuery} />
              <Button onClick={() => void pickImport()} disabled={locked}>{t('audio.addSound')}</Button>
            </div>
            {isList ? <button type="button" className="au-advanced" aria-expanded={advanced} disabled={locked || state.draft.length > 1}
              title={state.draft.length > 1 ? t('audio.advanced.toggleTitle') : undefined}
              onClick={() => setAdvancedOpen(open => ({ ...open, [event]: !advanced }))}>
              <span aria-hidden="true">{advanced ? '▾' : '▸'}</span>{t('audio.advanced.toggle')}
            </button> : null}
            {advanced ? <div className="au-draft">
              <div className="au-draft-head">
                <strong>{t('audio.advanced.head', { count: state.draft.length })}{pendingHere ? t('audio.advanced.changed') : t('audio.advanced.same')}</strong>
                {state.draft.length ? <Button variant="ghost" disabled={locked} onClick={() => controller.clear()}>{t('audio.clear')}</Button> : null}
              </div>
              {state.draft.length ? state.draft.map((name, index) => <div className="au-draft-row" key={`${index}-${name}`}>
                <span>{`${index + 1}. `}{name}</span>
                <Button variant="ghost" aria-label={t('audio.draft.moveUp', { index: index + 1 })} disabled={locked || index === 0} onClick={() => controller.move(index, -1)}>↑</Button>
                <Button variant="ghost" aria-label={t('audio.draft.moveDown', { index: index + 1 })} disabled={locked || index === state.draft.length - 1} onClick={() => controller.move(index, 1)}>↓</Button>
                <Button variant="ghost" aria-label={t('audio.draft.removeAria', { index: index + 1 })} disabled={locked} onClick={() => controller.remove(index)}>{t('audio.remove')}</Button>
              </div>) : <p className="ws-note">{t('audio.draft.empty')}</p>}
            </div> : null}
            <p className="ws-note">{query ? t('audio.sounds.matchCount', { shown: shownSounds.length, total: state.sounds.length }) : t('audio.sounds.count', { count: state.sounds.length })}</p>
            <div className="au-sounds">
              {isList && !advanced && !query ? <div className="au-sound">
                <button type="button" className="au-pick" aria-label={t('audio.none.label')} aria-pressed={state.draft.length === 0} disabled={locked} onClick={() => controller.clear()}>
                  <span className="au-sound-copy"><strong>{t('audio.none.label')}</strong><small>{t('audio.none.hint')}</small></span>
                  {binding.length === 0 ? <Tag kind="current" /> : null}{pendingHere && state.draft.length === 0 ? <Tag kind="pending" /> : null}
                </button>
              </div> : null}
              {shownSounds.map(sound => {
                const tags = <>
                  {sound.file === state.lastAdded ? <Tag kind="added" /> : null}
                  {binding.includes(sound.name) ? <Tag kind="current" /> : null}
                  {advanced ? (state.draft.includes(sound.name) ? <Tag kind="pending">{t('audio.advanced.inList')}</Tag> : null)
                    : pendingHere && state.draft.includes(sound.name) ? <Tag kind="pending" /> : null}
                </>
                const copy = <span className="au-sound-copy"><strong>{sound.name}</strong><small>{sound.ambiguous ? t('audio.sounds.ambiguous') : sound.file}</small></span>
                return <div className={`au-sound${playing(sound.path) ? ' au-sound-playing' : ''}`} key={sound.path} ref={sound.file === state.lastAdded ? addedRow : undefined}>
                  {advanced ? <>{copy}{tags}</>
                    : <button type="button" className="au-pick" aria-label={t('audio.pick.aria', { name: sound.name })} aria-pressed={state.draft.length === 1 && state.draft[0] === sound.name}
                      disabled={locked || sound.ambiguous} onClick={() => (isList ? controller.only(sound.name) : controller.add(sound.name))}>{copy}{tags}</button>}
                  <Button variant={playing(sound.path) ? 'secondary' : 'ghost'} aria-pressed={playing(sound.path)}
                    aria-label={`${playing(sound.path) ? t('audio.action.stop') : t('audio.action.play')} ${sound.name}`} onClick={() => void play(sound.path)}>{playing(sound.path) ? t('audio.stop.button') : t('audio.play.button')}</Button>
                  {advanced ? <Button aria-label={t('audio.addToList.aria', { name: sound.name })} disabled={locked || sound.ambiguous} onClick={() => controller.add(sound.name)}>{t('audio.addToList.button')}</Button> : null}
                  {fav.enabled ? <FavoriteStar on={fav.isFavorite(sound.file)} label={t('favorites.star', { label: sound.name })}
                    onToggle={() => { void fav.toggle(sound.file, state.sounds.map(item => item.file)).then(failure => { if (failure) show(msg(failure)) }) }} /> : null}
                </div>
              })}
              {query && !shownSounds.length ? <p className="ws-note">{t('audio.sounds.noMatch', { query })}</p> : null}
              <ExploreLink kind="sound" />
            </div>
            {audition.status === 'error' ? <Notice tone="error"><p>{msg(audition.message)}</p></Notice> : null}
          </section>
        </div>
      </> : null}
    </WorkspaceShell>
  )
}
