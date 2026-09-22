import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { useLang, useMsg, useT } from '../i18n'
import { crosshairFileName, crosshairNameIssue, type CrosshairController } from './controller'
import { createCrosshairExportController, type CrosshairExportBridge } from './export-controller'

/**
 * Paste a CS2/VALORANT code, preview it, and add it to the game's crosshairs folder.
 *
 * The write goes through the page controller's add path, because a native session holds one
 * plan and one job: the name rules, the taken-name check and the unknown-result lock already
 * live there. This sheet owns only the render, plus the secondary "save a copy elsewhere".
 */
export function CodeExportDialog({ bridge, controller, onClose }: {
  bridge: CrosshairExportBridge
  controller: CrosshairController
  onClose: () => void
}) {
  const t = useT()
  const { lang } = useLang()
  const msg = useMsg()
  const page = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const gameRoot = page.gameRoot ?? ''
  const renderer = useMemo(() => createCrosshairExportController(bridge, gameRoot), [bridge, gameRoot])
  const state = useSyncExternalStore(renderer.subscribe, renderer.getState, renderer.getState)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!state.svg) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(new Blob([state.svg], { type: 'image/svg+xml' }))
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [state.svg])
  const busy = state.saving || page.applying
  // A name taken in the game blocks adding, but a copy saved elsewhere only needs a valid name.
  const validName = crosshairNameIssue(page.newName) === null
  const freeName = validName && !page.nameError
  async function add() {
    if (!state.pngBase64) return
    const added = await controller.addGenerated({ label: t('crosshair.generatedLabel'), pngBase64: state.pngBase64, width: state.width, height: state.height })
    // An unknown result locks the page until Check result, which sits behind this sheet.
    if (added || controller.getState().unresolved) onClose()
  }
  return <Dialog variant="sheet" open title={t('crosshair.entry.code.title')} onClose={() => { if (!busy) onClose() }}>
    <p className="cx-note">{t('crosshair.code.note')}</p>
    <div className="cx-name-field">
      <label htmlFor="crosshair-code">{t('crosshair.code.label')}</label>
      <textarea id="crosshair-code" rows={3} value={state.code} onChange={event => renderer.setCode(event.target.value)} disabled={busy} maxLength={4096} spellCheck={false} />
    </div>
    <Button disabled={busy || !state.code.trim()} onClick={() => void renderer.preview()}>{t('crosshair.preview')}</Button>

    {previewUrl ? <div className="cx-code-preview">
      <img src={previewUrl} alt={t('crosshair.code.previewAlt')} />
      <span className="cx-note">{t('crosshair.code.previewSize', { width: state.width, height: state.height })}</span>
    </div> : null}
    {state.warnings.length ? <Notice tone="warning">{state.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</Notice> : null}

    <div className="cx-name-field">
      <label htmlFor="crosshair-code-name">{t('crosshair.fileName')}</label>
      <input id="crosshair-code-name" value={page.newName} onChange={event => controller.setNewName(event.target.value)} disabled={busy} aria-invalid={!!page.nameError} aria-describedby={page.nameError ? 'crosshair-code-name-error' : undefined} placeholder={t('crosshair.namePlaceholderCode')} maxLength={128} />
      {page.nameError ? <p id="crosshair-code-name-error" className="pr-error">{msg(page.nameError)}</p> : null}
    </div>
    <div className="cx-picker-source"><span className="ws-muted">{t('crosshair.destination')}</span><span className="ws-path">{page.directory}</span></div>

    {page.error ? <Notice tone="error"><p>{msg(page.error)}</p></Notice> : null}
    {state.error ? <Notice tone="error"><p>{msg(state.error)}</p></Notice> : null}
    {state.message ? <p role="status" className="pr-status">{msg(state.message)}</p> : null}
    <div className="ki-dialog-actions">
      <Button data-safe-focus disabled={busy} onClick={onClose}>{t('crosshair.close')}</Button>
      <Button variant="ghost" disabled={busy || !state.ready || !validName} onClick={() => void renderer.saveAs(crosshairFileName(page.newName), lang)}>{state.saving ? t('crosshair.saving') : t('crosshair.saveAs')}</Button>
      <Button variant="primary" disabled={busy || !state.ready || !freeName} onClick={() => void add()}>{page.applying ? t('crosshair.adding') : t('crosshair.addToGame')}</Button>
    </div>
  </Dialog>
}
