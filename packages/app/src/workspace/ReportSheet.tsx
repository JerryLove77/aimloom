import { useEffect, useRef, useState } from 'react'
import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { useMsg, useT, type Lang, type Msg } from '../i18n'
import { DESCRIPTION_MAX, CONTACT_MAX, type ReportContext, type ReportController } from './report-controller'
import { FEEDBACK_EMAIL } from './SettingsPopover'
import { errorMsg } from './issue-text'
import type { SteamAccount } from '../installer/contracts'

/**
 * Send a bug report from inside the App (spec §2.2). Owned by `Workspace`, published through
 * `SettingsState.rootOverlay` so it renders inside `WorkspaceShell`'s token wrapper (the shell
 * cannot hold an `overlays` prop for it directly: only the active page's shell is mounted).
 *
 * `controller` lives in `Workspace` for the whole session, not per mount of this component: the
 * draft (description/contact/attachLog) must survive Cancel/Esc closing the sheet, the same rule
 * every other page's draft follows. This component only subscribes to it and renders it.
 *
 * `account`, `langChoice`, `lang` and `gameFound` are read once by the caller when the sheet
 * opens (decision 6) — this component only displays them and hands them to the controller on
 * every preview/send, so an edit to the form always builds against the current values.
 */
export function ReportSheet({ controller, account, langChoice, lang, gameFound, onOpenLogs, onClose }: {
  controller: ReportController
  account: SteamAccount | null
  langChoice: string
  lang: Lang
  gameFound: boolean
  onOpenLogs(): Promise<void>
  onClose: () => void
}) {
  const t = useT()
  const msg = useMsg()
  const [state, setState] = useState(controller.getState())
  useEffect(() => controller.subscribe(() => setState(controller.getState())), [controller])
  const [copied, setCopied] = useState(false)
  // Mirrors the guard SettingsPopover uses for accountResolve: a promise (clipboard write here)
  // that settles after the sheet has unmounted must set no state.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Same as SettingsPopover: 打开日志文件夹 can refuse (most often a fresh install where the
  // worker has never spawned), and this failure screen is exactly where a player is already
  // confused, so the refusal must be shown, not silently swallowed.
  const [logsError, setLogsError] = useState<Msg | null>(null)
  const openLogs = () => {
    setLogsError(null)
    onOpenLogs().catch((error: unknown) => {
      if (!mountedRef.current) return
      setLogsError(errorMsg(error, { key: 'settings.feedback.openLogsFailed' }))
    })
  }

  const ctx: ReportContext = { account, langChoice, lang, gameFound }
  const busy = state.phase === 'sending'
  // Send must not be reachable while a preview is still loading: clicking it wouldn't be wrong
  // (the controller de-dupes onto the same in-flight request) but it is a needless second path
  // into the same network call, and the precondition the B1 race needed to be reachable at all.
  const sendBusy = busy || (state.phase === 'previewing' && state.previewLoading)
  const close = () => { if (!busy) { controller.closeSheet(); onClose() } }

  function copy() {
    const number = state.number
    if (!number) return
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) return
    clipboard.writeText(number)
      .then(() => { if (mountedRef.current) setCopied(true) })
      .catch(() => { /* nothing to show: the number is still on screen, selectable */ })
  }

  return <Dialog variant="sheet" open title={t('report.title')} onClose={close}>
    <p className="ws-note">{t('report.subtitle')}</p>

    {state.phase === 'sent' ? <>
      <p className="ws-report-result">{t('report.sent.title')}</p>
      <p className="ws-report-number">{t('report.sent.number', { number: state.number ?? '' })}</p>
      <p className="ws-note">{t('report.sent.note')}</p>
      <div className="ki-dialog-actions">
        <Button onClick={copy}>{copied ? t('report.sent.copied') : t('report.sent.copy')}</Button>
        <Button data-safe-focus variant="primary" onClick={() => { controller.finishSent(); onClose() }}>{t('report.sent.done')}</Button>
      </div>
    </> : state.phase === 'failed' ? <>
      <Notice tone="error"><p>{msg(state.sendError ?? { key: 'report.failed.generic' })}</p></Notice>
      <p className="ws-note">{t('report.failed.kept')}</p>
      <p className="ws-note">{t('report.failed.writeTo')} <span className="ws-settings-email">{FEEDBACK_EMAIL}</span></p>
      <div className="ki-dialog-actions">
        {/* A failure is the state a player most wants to leave, and Esc is not something everyone
            knows. Closing keeps what they typed, exactly as Cancel does on the form. */}
        <Button onClick={() => { controller.closeSheet(); onClose() }}>{t('crosshair.close')}</Button>
        <Button onClick={openLogs}>{t('settings.feedback.openLogs')}</Button>
        <Button data-safe-focus variant="primary" onClick={() => controller.retry()}>{t('report.retry')}</Button>
      </div>
      {logsError ? <Notice tone="error"><p>{msg(logsError)}</p></Notice> : null}
    </> : <>
      <div className="ws-field">
        <label htmlFor="report-description">{t('report.description')}</label>
        <textarea id="report-description" className="ws-report-textarea" value={state.description} maxLength={DESCRIPTION_MAX}
          disabled={busy} onChange={event => controller.setDescription(event.target.value)} />
        <p className="ws-note">{t('report.description.count', { count: state.description.length, max: DESCRIPTION_MAX })}</p>
      </div>
      <div className="ws-field">
        <label htmlFor="report-contact">{t('report.contact')}</label>
        <input id="report-contact" type="text" value={state.contact} maxLength={CONTACT_MAX}
          disabled={busy} onChange={event => controller.setContact(event.target.value)} />
        <p className="ws-note">{t('report.contact.hint')}</p>
      </div>
      <label className="ws-settings-switch">
        <input type="checkbox" checked={state.attachLog} disabled={busy} onChange={event => controller.setAttachLog(event.target.checked)} />
        <span>{t('report.attachLog')}</span>
      </label>
      <p className="ws-note">{t('report.attachLog.hint')}</p>
      <p className="ws-note">{account ? t('report.sentAs', { name: account.name }) : t('report.sentAnonymous')}</p>

      <Button type="button" disabled={busy} aria-expanded={state.phase === 'previewing'} onClick={() => { void controller.togglePreview(ctx) }}>
        {t('report.preview.show')}
      </Button>
      {state.phase === 'previewing' ? (state.previewLoading
        ? <p role="status" className="ws-note">{t('report.preview.loading')}</p>
        : <>
          <pre className="ws-report-preview">{state.previewText}</pre>
          <p className="ws-note">{t('report.preview.note')}</p>
        </>) : null}

      <p className="ws-note">{t('report.privacy')}</p>
      {state.sendError ? <Notice tone="error"><p>{msg(state.sendError)}</p></Notice> : null}
      {busy ? <p role="status" className="ws-note">{t('report.sending.note')}</p> : null}
      <div className="ki-dialog-actions">
        <Button data-safe-focus disabled={busy} onClick={() => { controller.closeSheet(); onClose() }}>{t('import.cancel')}</Button>
        <Button variant="primary" disabled={sendBusy} onClick={() => { void controller.send(ctx) }}>{busy ? t('report.sending') : t('report.send')}</Button>
      </div>
    </>}
  </Dialog>
}
