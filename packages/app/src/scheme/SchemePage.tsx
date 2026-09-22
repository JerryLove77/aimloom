import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '../installer/components/Button'
import { Notice } from '../installer/components/Notice'
import { WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { StatusStrip, Tag, Toast, useToast } from '../workspace/ui'
import { ImportSheet } from '../workspace/ImportSheet'
import { importFileName } from '../workspace/import-check'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { createSchemeController, type SchemeBridge } from './controller'
import { SchemePreview } from './SchemePreview'
import { Tiles, type TileChoice } from '../workspace/Tiles'
import type { ProfileAssetBridge } from '../profiles/assets'
import { useLang, useMsg, useT } from '../i18n'
import './scheme.css'

const PER_PAGE = 12

export function SchemePage({ bridge, assets, isDemo = false, isActive = true, section, onSelect, onOpenInstaller, fileDrops = noFileDrops }: {
  bridge: SchemeBridge
  assets: ProfileAssetBridge
  isDemo?: boolean
  isActive?: boolean
  section: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  onOpenInstaller?: (() => void) | undefined
  /** Files dragged in from outside the app. Only the active section reacts. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const controller = useMemo(() => createSchemeController(bridge), [bridge])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const [page, setPage] = useState(0)
  const { toast, tone, hide, show } = useToast(state.message ? msg(state.message) : null)
  /** The outside file being confirmed in the add sheet. Nothing is written until Add to game. */
  const [importPath, setImportPath] = useState<string | null>(null)
  useEffect(() => { if (isActive && state.phase === 'idle') void controller.load() }, [isActive, controller, state.phase])
  useEffect(() => { setPage(0) }, [state.themes])
  // A theme that was just added is selected; turn to the page it landed on.
  useEffect(() => {
    const index = state.selected ? state.themes.findIndex(theme => theme.file === state.selected?.file) : -1
    if (index >= 0) setPage(Math.floor(index / PER_PAGE))
  }, [state.selected, state.themes])
  useEffect(() => { if (!isActive) setImportPath(null) }, [isActive])
  const locked = state.applying || state.unresolved || state.phase === 'locating' || state.phase === 'loading'
  const openImport = (path: string) => { controller.clearImportError(); setImportPath(path) }
  const dropHint = useFileDrop(fileDrops, {
    section: 'scheme', active: isActive, busy: locked, onRefused: show,
    onFile: path => (state.phase === 'ready' ? openImport(path) : show(t('scheme.dropNeedsFolder'))),
  })
  if (!isActive) return null
  const lastPage = Math.max(0, Math.ceil(state.themes.length / PER_PAGE) - 1)
  const activePage = Math.min(page, lastPage)
  /** Selecting the theme already in effect is not a change, so it never enables Apply. */
  const pending = state.selected && state.selected.name !== state.current ? state.selected : null
  // One shape for the grid, shared with the same grid inside Profile. An unreadable theme stays
  // visible and unselectable -- hiding it would leave the player wondering where their file went.
  const choices: TileChoice[] = state.themes.map(theme => ({
    file: theme.file,
    label: theme.name ?? theme.file,
    detail: theme.readable ? theme.file : t('scheme.tile.fileUnreadable'),
    path: theme.path,
    selectable: theme.readable && !theme.duplicateName,
    reason: !theme.readable ? t('scheme.tile.unreadable') : theme.duplicateName ? t('scheme.tile.duplicateTitle') : undefined,
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
      preview={<SchemePreview path={importPath} name={importFileName(importPath)} assets={assets} />}
      onAdd={addImport} onClose={() => setImportPath(null)} /> : null}
  </>
  const actions = !ready ? undefined : state.unresolved
    ? <><Button disabled>{t('scheme.discard')}</Button><Button variant="primary" onClick={() => void controller.reconcile()}>{t('scheme.reconcile')}</Button></>
    : <><Button disabled={!pending || state.applying} onClick={() => controller.close()}>{t('scheme.discard')}</Button>
      <Button variant="primary" disabled={!pending || state.applying} onClick={() => void controller.apply()}>{state.applying ? t('scheme.applying') : t('scheme.apply')}</Button></>
  const actionNote = state.applying ? t('scheme.note.applying')
    : state.unresolved ? t('scheme.note.unresolved')
    : pending ? t('scheme.note.pending', { current: state.current ?? t('scheme.notSet'), next: pending.name ?? t('scheme.notSet') })
    : t('scheme.note.default')
  return (
    <WorkspaceShell overlays={overlays} dropHint={dropHint} active={section} onSelect={onSelect} isDemo={isDemo} locked={locked} onOpenInstaller={onOpenInstaller}
      eyebrow={t('scheme.eyebrow')} title={t('scheme.title')} scope={t('scheme.scope')}
      actions={actions} actionNote={actionNote}>
      {state.unresolved ? <Notice tone="warning"><p>{state.error ? msg(state.error) : t('scheme.error.unresolved')}</p></Notice>
        : state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}

      {state.phase === 'locating' ? <p role="status">{t('scheme.status.locating')}</p> : null}
      {state.phase === 'loading' ? <p role="status">{t('scheme.status.loading')}</p> : null}
      {state.phase === 'needs-location' ? <div className="sc-locate">
        <p>{state.candidates.length ? t('scheme.locate.multiple') : t('scheme.locate.none')}</p>
        {state.candidates.map(candidate => <button type="button" className="sc-candidate" key={candidate} disabled={locked} onClick={() => void controller.chooseGameRoot(candidate)}>{candidate}</button>)}
        <Button variant="primary" disabled={locked} onClick={() => void controller.chooseFolder(lang)}>{t('scheme.locate.chooseFolder')}</Button>
      </div> : null}
      {state.phase === 'error' ? <div className="sc-locate"><Button variant="primary" onClick={() => void controller.chooseFolder(lang)}>{t('scheme.locate.chooseGameFolder')}</Button></div> : null}

      {ready ? <>
        <StatusStrip current={state.current ?? t('scheme.notSet')} pending={pending ? pending.name : null}
          aside={<><span>{t('scheme.note.takesEffect')}</span><Button onClick={() => void pickImport()} disabled={locked}>{t('scheme.addTheme')}</Button><Button variant="ghost" onClick={() => void controller.load()} disabled={locked}>{t('scheme.refresh')}</Button></>} />
        <div className="ws-columns">
          <div>
            <Tiles choices={choices} page={activePage} pageSize={PER_PAGE} disabled={locked} countKey="scheme.pagination.count"
              ariaLabel={choice => t('scheme.tile.previewLabel', { label: choice.label })}
              thumb={choice => choice.selectable || choice.duplicate
                ? <SchemePreview path={choice.path} name={choice.label} assets={assets} className="ws-tile-thumb" />
                : <span className="ws-tile-thumb">{t('scheme.tile.unreadableShort')}</span>}
              onPage={setPage}
              onChoose={choice => {
                const theme = state.themes.find(item => item.file === choice.file)
                if (!theme) return
                theme.readable && theme.name === state.current ? controller.close() : controller.open(theme)
              }}
              empty={<div className="pr-empty"><span aria-hidden="true">▱</span><h2>{t('scheme.empty.title')}</h2><p>{t('scheme.empty.body')}</p></div>} />
          </div>
          <section className="ws-panel" aria-label={t('scheme.panel.ariaLabel')}>
            <div className="ws-panel-head"><h2>{t('scheme.panel.heading')}</h2>{shown ? <Tag kind={pending ? (state.applying ? 'working' : 'pending') : 'current'} /> : null}</div>
            {shown
              ? <SchemePreview key={shown.path} path={shown.path} name={shown.name ?? shown.file} assets={assets} className="ws-preview-large" />
              : <div className="ws-preview-large">{t('scheme.panel.empty')}</div>}
            {shown ? <><strong>{shown.name ?? shown.file}</strong><span className="ws-path">{shown.path}</span></> : null}
            <p className="ws-note">{t('scheme.panel.note')}</p>
          </section>
        </div>
      </> : null}
    </WorkspaceShell>
  )
}
