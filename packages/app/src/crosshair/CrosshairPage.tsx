import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { Toast, useToast } from '../workspace/ui'
import { useLang, useMsg, useT } from '../i18n'
import { errorMsg } from '../workspace/issue-text'
import { importFileName, stemOf } from '../workspace/import-check'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { createCrosshairController, type CrosshairBridge } from './controller'
import { CodeExportDialog } from './CodeExportDialog'
import type { CrosshairExportBridge } from './export-controller'
import { assetMime, type ProfileAssetBridge } from '../profiles/assets'
import './crosshair.css'

/** One PNG preview, read through the existing read-only asset boundary. */
function SlotImage({ path, assets, alt }: { path: string; assets: ProfileAssetBridge; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    void (async () => {
      try {
        const bytes = await assets.read('crosshair', path)
        if (cancelled) return
        created = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: assetMime('crosshair', path) }))
        setUrl(created)
      } catch { /* the row still names the file */ }
    })()
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created) }
  }, [path, assets])
  if (!url) return <span className="ws-tile-thumb">…</span>
  return <img className="ws-tile-thumb" src={url} alt={alt} />
}

/** The chosen replacement image, decoded from the controller's canonical PNG. */
function SourceImage({ base64, alt }: { base64: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const created = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    setUrl(created)
    return () => URL.revokeObjectURL(created)
  }, [base64])
  return url ? <img className="cx-compare-image" src={url} alt={alt} /> : null
}

export function CrosshairPage({ bridge, assets, isDemo = false, isActive = true, section, onSelect, onOpenInstaller, fileDrops = noFileDrops }: {
  bridge: CrosshairBridge & CrosshairExportBridge
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
  const readSource = useMemo(() => (path: string) => assets.read('crosshair', path), [assets])
  const controller = useMemo(() => createCrosshairController(bridge, readSource), [bridge, readSource])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const [exporting, setExporting] = useState(false)
  const [query, setQuery] = useState('')
  const { toast, tone, hide, show } = useToast(state.message ? msg(state.message) : null)
  useEffect(() => { if (isActive && state.phase === 'idle') void controller.load() }, [isActive, controller, state.phase])
  // Leaving the section closes whichever sheet is open (decision A). Each sheet follows the
  // controller's choice, so the choice itself is cleared rather than left to reopen it.
  useEffect(() => {
    if (isActive) return
    setExporting(false)
    const current = controller.getState()
    if (!current.applying && (current.mode === 'add' || current.slot !== null)) controller.close()
  }, [isActive, controller])
  const locked = state.applying || state.unresolved || state.reading || state.phase === 'locating' || state.phase === 'loading'
  // Every write happens in a sheet with its own primary button; the page itself holds nothing
  // pending. An unknown result closes the sheet and locks the page until it is checked.
  const addOpen = state.mode === 'add' && !exporting && !state.unresolved
  const slot = state.mode === 'replace' && !state.unresolved ? state.slot : null
  /** A PNG from the file dialog or a drop goes to the add sheet, named after its file. */
  const addFrom = (path: string) => {
    if (controller.getState().mode !== 'add') { controller.startAdd(); controller.setNewName(stemOf(importFileName(path))) }
    void controller.chooseSource(path)
  }
  async function pickPng(): Promise<string | null> {
    try { return await bridge.pickFile('crosshair', lang) } catch (error) { show(msg(errorMsg(error, { key: 'crosshair.error.pickImport' }))); return null }
  }
  async function addFromPicker() { const path = await pickPng(); if (path) addFrom(path) }
  async function replaceFromPicker() { const path = await pickPng(); if (path) void controller.chooseSource(path) }
  // A drop is an add; while the code sheet or a file's sheet is open, it is ignored.
  const dropHint = useFileDrop(fileDrops, {
    section: 'crosshair', active: isActive && !exporting && slot === null, busy: locked, onRefused: show,
    onFile: path => (state.phase === 'ready' ? addFrom(path) : show(t('crosshair.dropNeedsFolder'))),
  })
  if (!isActive) return null
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle ? state.slots.filter(item => item.file.toLocaleLowerCase().includes(needle)) : state.slots
  const nameUsable = state.newName.trim() !== '' && !state.nameError
  const overlays = <>
    <Toast message={toast} tone={tone} onDone={hide} />
    <Dialog variant="sheet" open={addOpen} title={t('crosshair.import.title')} onClose={() => { if (!state.applying) controller.close() }}>
      <p className="ws-note">{t('crosshair.import.note')}</p>
      <div className="cx-single">{state.source
        ? <figure><SourceImage base64={state.source.pngBase64} alt={t('crosshair.newImageAlt')} /><figcaption>{t('crosshair.dimensions', { width: state.source.width, height: state.source.height })}</figcaption></figure>
        : <span className="cx-compare-image" role="status">{state.reading ? t('crosshair.reading') : t('crosshair.noImage')}</span>}</div>
      <dl className="ws-import-facts">
        <div><dt>{t('crosshair.source')}</dt><dd className="ws-path">{state.source?.path || '—'}</dd></div>
        <div><dt>{t('crosshair.destination')}</dt><dd className="ws-path">{state.directory}</dd></div>
      </dl>
      <div className="cx-name-field"><label htmlFor="crosshair-name">{t('crosshair.fileName')}</label><input id="crosshair-name" value={state.newName} onChange={event => controller.setNewName(event.target.value)} disabled={locked} aria-invalid={!!state.nameError} aria-describedby={state.nameError ? 'crosshair-name-error' : undefined} placeholder={t('crosshair.namePlaceholderAdd')} maxLength={128} />{state.nameError ? <p id="crosshair-name-error" className="pr-error">{msg(state.nameError)}</p> : null}</div>
      <p className="ws-note">{t('crosshair.import.pngNote')}</p>
      {state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}
      <div className="ki-dialog-actions"><Button data-safe-focus disabled={state.applying} onClick={() => controller.close()}>{t('crosshair.cancel')}</Button>
        <Button variant="ghost" disabled={locked} onClick={() => void addFromPicker()}>{t('crosshair.chooseAnother')}</Button>
        <Button variant="primary" disabled={!state.ready || locked || !nameUsable} onClick={() => void controller.apply()}>{state.applying ? t('crosshair.adding') : t('crosshair.addToGame')}</Button></div>
    </Dialog>
    <Dialog variant="sheet" open={slot !== null} title={slot?.file ?? ''} onClose={() => { if (!state.applying) controller.close() }}>
      {slot ? <>
        <div className={state.source ? 'cx-compare' : 'cx-single'}>
          <figure><SlotImage path={slot.path} assets={assets} alt={t('crosshair.originalAlt')} /><figcaption>{t('crosshair.currentImageCaption')}</figcaption></figure>
          {state.source ? <figure><SourceImage base64={state.source.pngBase64} alt={t('crosshair.newImageAlt')} /><figcaption>{t('crosshair.newImageCaption', { name: state.source.name, width: state.source.width, height: state.source.height })}</figcaption></figure> : null}
        </div>
        <span className="ws-path">{slot.path}</span>
        <p className="ws-note">{t('crosshair.replace.note')}</p>
        {state.reading ? <p role="status" className="ws-note">{t('crosshair.reading')}</p> : null}
        {state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}
      </> : null}
      <div className="ki-dialog-actions"><Button data-safe-focus disabled={state.applying} onClick={() => controller.close()}>{t('crosshair.close')}</Button>
        <Button disabled={locked} onClick={() => void replaceFromPicker()}>{t('crosshair.chooseAnotherImage')}</Button>
        <Button variant="primary" disabled={!state.ready || locked} onClick={() => void controller.apply()}>{state.applying ? t('crosshair.replacing') : t('crosshair.replace')}</Button></div>
    </Dialog>
    {exporting && state.gameRoot ? <CodeExportDialog bridge={bridge} controller={controller} onClose={() => { setExporting(false); controller.close() }} /> : null}
  </>
  const sheetOpen = addOpen || slot !== null || exporting
  return (
    <WorkspaceShell overlays={overlays} dropHint={dropHint} active={section} onSelect={onSelect} isDemo={isDemo} locked={locked} onOpenInstaller={onOpenInstaller}
      eyebrow={t('crosshair.eyebrow')} title={t('crosshair.title')} scope={t('crosshair.scope')}>
      {state.unresolved ? <Notice tone="warning"><p>{state.error ? msg(state.error) : t('crosshair.error.unresolvedNotice')}</p>
        <p><Button variant="primary" onClick={() => void controller.reconcile()}>{t('crosshair.reconcile')}</Button></p></Notice>
        : state.error && !sheetOpen ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}

      {state.phase === 'locating' ? <p role="status">{t('crosshair.status.locating')}</p> : null}
      {state.phase === 'loading' ? <p role="status">{t('crosshair.status.loading')}</p> : null}
      {state.phase === 'needs-location' ? <div className="sc-locate">
        <p>{state.candidates.length ? t('crosshair.locate.multiple') : t('crosshair.locate.none')}</p>
        {state.candidates.map(candidate => <button type="button" className="sc-candidate" key={candidate} disabled={locked} onClick={() => void controller.chooseGameRoot(candidate)}>{candidate}</button>)}
        <Button variant="primary" disabled={locked} onClick={() => void controller.chooseFolder(lang)}>{t('crosshair.locate.chooseFolder')}</Button>
      </div> : null}
      {state.phase === 'error' ? <div className="sc-locate"><Button variant="primary" onClick={() => void controller.chooseFolder(lang)}>{t('crosshair.locate.chooseGameFolder')}</Button></div> : null}

      {state.phase === 'ready' ? <>
        <div className="cx-entries">
          <button type="button" className="cx-entry" aria-label={t('crosshair.entry.code.title')} disabled={locked || !state.gameRoot} onClick={() => { controller.startAdd(); setExporting(true) }}>
            <span className="cx-entry-icon" aria-hidden="true">#</span>
            <span className="cx-entry-copy"><strong>{t('crosshair.entry.code.title')}</strong><small>{t('crosshair.entry.code.subtitle')}</small></span>
          </button>
          <button type="button" className="cx-entry" aria-label={t('crosshair.entry.png.title')} disabled={locked} onClick={() => void addFromPicker()}>
            <span className="cx-entry-icon" aria-hidden="true">⇩</span>
            <span className="cx-entry-copy"><strong>{t('crosshair.entry.png.title')}</strong><small>{t('crosshair.entry.png.subtitle')}</small></span>
          </button>
        </div>
        <section className="cx-installed" aria-labelledby="crosshair-installed">
          <div className="cx-installed-head">
            <h2 id="crosshair-installed">{t('crosshair.installed.heading', { count: state.slots.length })}</h2>
            <div className="pr-search">
              <label className="pr-sr-only" htmlFor="crosshair-search">{t('crosshair.search.label')}</label>
              <input id="crosshair-search" type="search" placeholder={t('crosshair.search.placeholder')} value={query} onChange={change => setQuery(change.target.value)} />
              {query ? <Button variant="ghost" aria-label={t('crosshair.clearSearch')} onClick={() => setQuery('')}>×</Button> : null}
            </div>
            <Button variant="ghost" onClick={() => void controller.load()} disabled={locked}>{t('crosshair.refresh')}</Button>
          </div>
          <p className="ws-note">{t('crosshair.installed.hint')}</p>
          <div className="ws-grid cx-grid">{shown.map(item =>
            <button type="button" className="ws-tile cx-tile" key={item.file} aria-label={item.file} disabled={locked} onClick={() => controller.open(item)}>
              <SlotImage path={item.path} assets={assets} alt="" />
              <span className="ws-tile-copy"><strong>{item.file}</strong></span>
            </button>)}</div>
          {query && !shown.length ? <p className="ws-note">{t('crosshair.search.noMatch', { query })}</p> : null}
          {!state.slots.length ? <div className="pr-empty"><span aria-hidden="true">⊕</span><h2>{t('crosshair.empty.title')}</h2><p>{t('crosshair.empty.body')}</p></div> : null}
        </section>
      </> : null}
    </WorkspaceShell>
  )
}
