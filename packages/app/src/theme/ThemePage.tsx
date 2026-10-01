import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { StatusStrip, Tag, Toast, useToast } from '../ui/status'
import { ImportSheet } from '../section/ImportSheet'
import { importFileName } from '../section/import-check'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { SearchBox } from '../ui/SearchBox'
import { ExploreLink } from '../section/ExploreLink'
import { createThemeController, type ThemeBridge } from './controller'
import { ThemePreview } from './ThemePreview'
import { Tiles, type TileChoice } from '../ui/Tiles'
import type { ProfileAssetBridge } from '../bridge/assets'
import { useLang, useMsg, useT } from '../i18n'
import { LocatePanel } from '../section/LocatePanel'
import { sortFavoritesFirst, useFavorites, type FavoritesStore } from '../section/favorites'
import './theme.css'

const PER_PAGE = 12

export function ThemePage({ bridge, assets, favorites, isDemo = false, isActive = true, section, onSelect, fileDrops = noFileDrops }: {
  bridge: ThemeBridge
  assets: ProfileAssetBridge
  /** The starred themes, shown first; absent: no stars. */
  favorites?: FavoritesStore | undefined
  isDemo?: boolean
  isActive?: boolean
  section: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  /** Files dragged in from outside the app. Only the active section reacts. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const controller = useMemo(() => createThemeController(bridge), [bridge])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const { toast, tone, hide, show } = useToast(state.message ? msg(state.message) : null)
  /** The outside file being confirmed in the add sheet. Nothing is written until Add to game. */
  const [importPath, setImportPath] = useState<string | null>(null)
  const fav = useFavorites(favorites, 'theme', isActive)
  // Favourites first, then the engine's order; the search, the pages and the added-theme jump all read this order.
  const themes = useMemo(() => sortFavoritesFirst(state.themes, theme => theme.file, fav.names), [fav.names, state.themes])
  useEffect(() => { if (isActive && state.phase === 'idle') void controller.load() }, [isActive, controller, state.phase])
  useEffect(() => { setPage(0) }, [state.themes, query])
  // A theme that was just added is selected; turn to the page it landed on.
  useEffect(() => {
    const index = state.selected ? themes.findIndex(theme => theme.file === state.selected?.file) : -1
    if (index >= 0) setPage(Math.floor(index / PER_PAGE))
    // Only a new selection turns the page: starring a tile re-sorts the grid and must not jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selected])
  useEffect(() => { if (!isActive) setImportPath(null) }, [isActive])
  const locked = state.applying || state.unresolved || state.phase === 'locating' || state.phase === 'loading'
  const openImport = (path: string) => { controller.clearImportError(); setImportPath(path) }
  const dropHint = useFileDrop(fileDrops, {
    section: 'theme', active: isActive, busy: locked, onRefused: show,
    onFile: path => (state.phase === 'ready' ? openImport(path) : show(t('theme.dropNeedsFolder'))),
  })
  if (!isActive) return null
  const lastPage = Math.max(0, Math.ceil(themes.length / PER_PAGE) - 1)
  const activePage = Math.min(page, lastPage)
  /** Selecting the theme already in effect is not a change, so it never enables Apply. */
  const pending = state.selected && state.selected.name !== state.current ? state.selected : null
  // Filtering is presentation only: it narrows the grid, never the pending selection or the
  // current mark, which the controller still owns.
  const needle = query.trim().toLocaleLowerCase()
  const filteredThemes = needle
    ? themes.filter(theme => (theme.name ?? '').toLocaleLowerCase().includes(needle) || theme.file.toLocaleLowerCase().includes(needle))
    : themes
  // One shape for the grid, shared with the same grid inside Profile. An unreadable theme stays
  // visible and unselectable -- hiding it would leave the player wondering where their file went.
  const choices: TileChoice[] = filteredThemes.map(theme => ({
    file: theme.file,
    label: theme.name ?? theme.file,
    detail: theme.readable ? theme.file : t('theme.tile.fileUnreadable'),
    path: theme.path,
    selectable: theme.readable && !theme.duplicateName,
    reason: !theme.readable ? t('theme.tile.unreadable') : theme.duplicateName ? t('theme.tile.duplicateTitle') : undefined,
    current: theme.readable && theme.name === state.current,
    pending: pending?.file === theme.file,
    duplicate: theme.duplicateName,
  }))
  const shown = pending ?? state.themes.find(theme => theme.readable && theme.name === state.current) ?? null
  const ready = state.phase === 'ready'
  async function pickImport() {
    const path = await controller.pickImport(lang)
    if (path) openImport(path)
  }
  async function addImport(input: Parameters<typeof controller.importFile>[0]) {
    const added = await controller.importFile(input)
    // An unknown result locks the page until Check result, which sits behind this sheet.
    if (added || controller.getState().unresolved) setImportPath(null)
    return added
  }
  const overlays = <>
    <Toast message={toast} tone={tone} onDone={hide} />
    {importPath && state.directory ? <ImportSheet key={importPath} kind="theme" sourcePath={importPath} directory={state.directory}
      installed={state.themes.map(theme => ({ name: theme.name, file: theme.file }))} assets={assets} busy={state.importing} error={state.importError}
      preview={<ThemePreview path={importPath} name={importFileName(importPath)} assets={assets} />}
      onAdd={addImport} onClose={() => setImportPath(null)} /> : null}
  </>
  const actions = !ready ? undefined : state.unresolved
    ? <><Button disabled>{t('theme.discard')}</Button><Button variant="primary" onClick={() => void controller.reconcile()}>{t('theme.reconcile')}</Button></>
    : <><Button disabled={!pending || state.applying} onClick={() => controller.close()}>{t('theme.discard')}</Button>
      <Button variant="primary" disabled={!pending || state.applying} onClick={() => void controller.apply()}>{state.applying ? t('theme.applying') : t('theme.apply')}</Button></>
  const actionNote = state.applying ? t('theme.note.applying')
    : state.unresolved ? t('theme.note.unresolved')
    : pending ? t('theme.note.pending', { current: state.current ?? t('theme.notSet'), next: pending.name ?? t('theme.notSet') })
    : t('theme.note.default')
  return (
    <WorkspaceShell overlays={overlays} dropHint={dropHint} active={section} onSelect={onSelect} isDemo={isDemo}
      eyebrow={t('theme.eyebrow')} title={t('theme.title')} scope={t('theme.scope')}
      actions={actions} actionNote={actionNote}>
      {state.unresolved ? <Notice tone="warning"><p>{state.error ? msg(state.error) : t('theme.error.unresolved')}</p></Notice>
        : state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}

      {state.phase === 'locating' ? <p role="status">{t('theme.status.locating')}</p> : null}
      {state.phase === 'loading' ? <p role="status">{t('theme.status.loading')}</p> : null}
      <LocatePanel section="theme" phase={state.phase} candidates={state.candidates} locked={locked} controller={controller} />

      {ready ? <>
        <StatusStrip current={state.current ?? t('theme.notSet')} pending={pending ? pending.name : null}
          aside={<><span>{t('theme.note.takesEffect')}</span><Button onClick={() => void pickImport()} disabled={locked}>{t('theme.addTheme')}</Button><Button variant="ghost" onClick={() => void controller.load()} disabled={locked}>{t('theme.refresh')}</Button></>} />
        <div className="ws-columns">
          <div>
            <SearchBox id="theme-search" label={t('theme.search.label')} placeholder={t('theme.search.placeholder')}
              clearLabel={t('theme.clearSearch')} value={query} onChange={setQuery} />
            <Tiles choices={choices} page={activePage} pageSize={PER_PAGE} disabled={locked} countKey="theme.pagination.count"
              ariaLabel={choice => t('theme.tile.previewLabel', { label: choice.label })}
              thumb={choice => choice.selectable || choice.duplicate
                ? <ThemePreview path={choice.path} name={choice.label} assets={assets} className="ws-tile-thumb" />
                : <span className="ws-tile-thumb">{t('theme.tile.unreadableShort')}</span>}
              onPage={setPage}
              favorites={fav.enabled ? {
                isFavorite: choice => fav.isFavorite(choice.file),
                label: choice => t('favorites.star', { label: choice.label }),
                onToggle: choice => { void fav.toggle(choice.file, state.themes.map(theme => theme.file)).then(failure => { if (failure) show(msg(failure)) }) },
              } : undefined}
              onChoose={choice => {
                const theme = state.themes.find(item => item.file === choice.file)
                if (!theme) return
                theme.readable && theme.name === state.current ? controller.close() : controller.open(theme)
              }}
              empty={query ? undefined : <div className="pr-empty"><span aria-hidden="true">▱</span><h2>{t('theme.empty.title')}</h2><p>{t('theme.empty.body')}</p></div>} />
            {query && !choices.length ? <p className="ws-note">{t('theme.search.noMatch', { query })}</p> : null}
            <ExploreLink kind="theme" />
          </div>
          <section className="ws-panel" aria-label={t('theme.panel.ariaLabel')}>
            <div className="ws-panel-head"><h2>{t('theme.panel.heading')}</h2>{shown ? <Tag kind={pending ? (state.applying ? 'working' : 'pending') : 'current'} /> : null}</div>
            {shown
              ? <ThemePreview key={shown.path} path={shown.path} name={shown.name ?? shown.file} assets={assets} className="ws-preview-large" />
              : <div className="ws-preview-large">{t('theme.panel.empty')}</div>}
            {shown ? <><strong>{shown.name ?? shown.file}</strong><span className="ws-path">{shown.path}</span></> : null}
            <p className="ws-note">{t('theme.panel.note')}</p>
          </section>
        </div>
      </> : null}
    </WorkspaceShell>
  )
}
