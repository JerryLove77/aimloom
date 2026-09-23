import { useContext, useEffect, useRef, useState } from 'react'
import { LANGUAGE_NAMES, useLang, useMsg, useT, type LangChoice, type Msg } from '../i18n'
import { errorMsg } from './issue-text'
import { readAccount, writeAccount, looksLikeSteamUrl, type Account } from './account'
import { readUpdatesEnabled, writeUpdatesEnabled } from './updates'
import { updateAvailableKey } from './update-text'
import { SettingsState } from './WorkspaceShell'

/** feedback@aimloom.dev, unwrapped: plain selectable text, never a button or a mailto link. Shared with ReportSheet's failure view. */
export const FEEDBACK_EMAIL = 'feedback@aimloom.dev'

/** Language, account, feedback, updates and the version, anchored beside the sidebar's Settings button (Figma SET-A1/A2). */
export function SettingsPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const t = useT(); const msg = useMsg(); const { choice, setChoice, system, lang } = useLang()
  const settings = useContext(SettingsState)
  const ref = useRef<HTMLDivElement>(null)
  const [place] = useState(() => {
    const button = anchor.getBoundingClientRect(); const sidebar = anchor.closest('.ws-sidebar')?.getBoundingClientRect()
    return { left: (sidebar?.right ?? button.right) + 8, bottom: Math.max(8, window.innerHeight - button.bottom) }
  })
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>('input:checked')?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    const onDown = (e: Event) => { const target = e.target as Node; if (!ref.current?.contains(target) && !anchor.contains(target)) onClose() }
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [anchor, onClose])
  const choices: LangChoice[] = ['system', 'zh', 'en']

  // Unmounted (Esc, outside click, or the shell swapping sections) mid-resolve must store and
  // set nothing: the player never saw the result, so it never happened. `WorkspaceShell` only
  // ever renders one `SettingsPopover` while `settings.anchor` is set, and unmounts it the
  // instant that closes -- a still-pending `accountResolve` promise outlives that unmount.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  // Account: the player's own name for their Steam account, or the connect form. After a link
  // resolves, the name starts as the Steam name and the player may change it before saving
  // (user, 2026-09-23: 「App 也能自己起名」); the same name box renames a saved account.
  const [account, setAccount] = useState<Account | null>(() => readAccount(settings.storage))
  const [draft, setDraft] = useState<Account | null>(null)
  const [url, setUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [accountError, setAccountError] = useState<Msg | null>(null)
  const connect = () => {
    setAccountError(null)
    if (!looksLikeSteamUrl(url)) { setAccountError({ key: 'settings.account.badLink' }); return }
    setResolving(true)
    settings.accountResolve(url).then(resolved => {
      if (!mountedRef.current) return
      setResolving(false); setDraft(resolved)
    }).catch((error: unknown) => {
      if (!mountedRef.current) return
      setResolving(false); setAccountError(errorMsg(error, { key: 'settings.account.error' }))
    })
  }
  const removeAccount = () => { setAccount(null); setDraft(null); writeAccount(settings.storage, null); setUrl(''); setAccountError(null) }
  const draftName = draft?.name.trim() ?? ''
  const saveDraft = () => {
    if (!draft || !draftName || draftName.length > 64) return
    const saved = { steamId: draft.steamId, name: draftName }
    setAccount(saved); writeAccount(settings.storage, saved); setDraft(null); setUrl('')
  }

  // Updates: the startup-check switch and, once the launch check has answered, its result.
  const [updatesOn, setUpdatesOn] = useState(() => readUpdatesEnabled(settings.storage))
  const toggleUpdates = (on: boolean) => { setUpdatesOn(on); writeUpdatesEnabled(settings.storage, on) }
  const update = settings.update

  // 打开日志文件夹 can refuse -- most often a fresh install where the worker has never spawned, so
  // the logs folder does not exist yet. That refusal is a bilingual Issue; show it, do not let it
  // vanish as an unhandled rejection.
  const [logsError, setLogsError] = useState<Msg | null>(null)
  const openLogs = () => {
    setLogsError(null)
    settings.openLogs().catch((error: unknown) => {
      if (!mountedRef.current) return
      setLogsError(errorMsg(error, { key: 'settings.feedback.openLogsFailed' }))
    })
  }

  return <div ref={ref} className="ws-settings" role="dialog" aria-label={t('settings.title')} style={{ left: place.left, bottom: place.bottom }}>
    <h2>{t('settings.title')}</h2>
    <fieldset>
      <legend>{t('settings.language')}</legend>
      {choices.map(c => <label key={c}>
        <input type="radio" name="aimloom-language" value={c} checked={choice === c} onChange={() => setChoice(c)} />
        <span>{c === 'system' ? t('settings.language.system', { current: LANGUAGE_NAMES[system] }) : LANGUAGE_NAMES[c]}</span>
      </label>)}
    </fieldset>

    <section className="ws-settings-section">
      <h3>{t('settings.account')}</h3>
      {draft ? <div className="ws-settings-account">
        <label className="ws-muted" htmlFor="ws-account-name">{t('settings.account.name.hint')}</label>
        <input id="ws-account-name" type="text" value={draft.name} maxLength={64} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <button type="button" className="ki-button ki-button-secondary" onClick={saveDraft} disabled={!draftName}>{t('settings.account.save')}</button>
        <button type="button" className="ki-button ki-button-ghost" onClick={() => setDraft(null)}>{t('settings.account.cancel')}</button>
      </div> : account ? <div className="ws-settings-account">
        {/* Says only that it worked. A word about verification here reads as "it did not connect";
            verification belongs to the explorer's upload page, the one place that needs it. */}
        <p><span className="ws-settings-account-name">{account.name}</span><span className="ws-settings-account-tag">{t('settings.account.connected')}</span></p>
        <button type="button" className="ki-button ki-button-ghost" onClick={() => setDraft(account)}>{t('settings.account.rename')}</button>
        <button type="button" className="ki-button ki-button-ghost" onClick={removeAccount}>{t('settings.account.remove')}</button>
      </div> : <div className="ws-settings-account">
        <p className="ws-muted">{t('settings.account.hint')}</p>
        <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder={t('settings.account.placeholder')}
          aria-label={t('settings.account')} disabled={resolving} />
        <button type="button" className="ki-button ki-button-secondary" onClick={connect} disabled={resolving}>
          {resolving ? t('settings.account.resolving') : t('settings.account.connect')}
        </button>
        {accountError ? <p className="ws-settings-error" role="alert">{msg(accountError)}</p> : null}
      </div>}
    </section>

    <section className="ws-settings-section">
      <h3>{t('settings.feedback')}</h3>
      <p className="ws-muted">{t('settings.feedback.hint')}</p>
      <button type="button" className="ki-button ki-button-secondary" onClick={() => { settings.openReport(); onClose() }}>{t('settings.feedback.send')}</button>
      <button type="button" className="ki-button ki-button-ghost" onClick={openLogs}>{t('settings.feedback.openLogs')}</button>
      {logsError ? <p className="ws-settings-error" role="alert">{msg(logsError)}</p> : null}
      <p className="ws-settings-email">{FEEDBACK_EMAIL}</p>
    </section>

    <section className="ws-settings-section">
      <h3>{t('settings.updates')}</h3>
      <label className="ws-settings-switch">
        <input type="checkbox" checked={updatesOn} onChange={e => toggleUpdates(e.target.checked)} />
        <span>{t('settings.updates.check')}</span>
      </label>
      <label className="ws-settings-switch">
        <input type="checkbox" checked={settings.betaOn} onChange={e => settings.setBetaOn(e.target.checked)} />
        <span>{t('settings.updates.beta')}</span>
      </label>
      <p className="ws-muted">{t('settings.updates.beta.hint')}</p>
      {update && update.latest !== null ? (update.newer
        ? <p className="ws-settings-update">
            {t(updateAvailableKey(update), { version: update.latest })}{' '}
            <button type="button" className="ki-button ki-button-secondary" onClick={() => { void settings.openDownload(lang, update.channel) }}>{t('settings.updates.download')}</button>
          </p>
        : <p className="ws-settings-update">{t('settings.updates.current')}</p>) : null}
    </section>

    <p className="ws-settings-version">
      {t('settings.version', { version: settings.appInfo?.label ?? __APP_VERSION__ })}
      {settings.appInfo?.channel === 'beta' ? <span className="ws-tag ws-tag-pending ws-settings-beta-tag">{t('settings.version.beta')}</span> : null}
    </p>
  </div>
}
