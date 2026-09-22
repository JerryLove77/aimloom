import { Button } from '../installer/components/Button'
import { Dialog } from '../installer/components/Dialog'
import { Notice } from '../installer/components/Notice'
import { useMsg, useT } from '../i18n'
import { AUDIO_EVENTS } from './audio/model'
import type { ApplyState } from './apply-controller'
import type { CurrentGame } from './current-game'
import { describeEvent, describeFile, eventLabel } from './describe'

/**
 * Applies one saved Profile to the game: locate the folder if needed, preview the write, then
 * confirm. Reuses the same plan -> confirm -> execute -> job -> unknown/reconcile shape as every
 * current-configuration section (Scheme's controller in particular); an unknown outcome keeps
 * this dialog open and locked until 核对结果, exactly as a section locks itself.
 */
export function ApplyDialog({ state, current, onChooseGameRoot, onChooseFolder, onConfirm, onCancel, onReconcile }: {
  state: ApplyState
  current: CurrentGame | null
  onChooseGameRoot: (root: string) => void
  onChooseFolder: () => void
  onConfirm: () => void
  onCancel: () => void
  onReconcile: () => void
}) {
  const t = useT()
  const msg = useMsg()
  const open = state.phase !== 'idle'
  const profile = state.profile
  const applying = state.phase === 'applying'
  const unresolved = state.phase === 'unresolved'
  const busy = state.phase === 'locating' || state.phase === 'planning'
  return <Dialog open={open} title={t('profile.apply.title', { name: profile?.name ?? '' })} onClose={() => { if (!applying && !unresolved) onCancel() }}>
    {state.phase === 'needs-location' ? <div>
      <p>{state.candidates.length ? t('scheme.locate.multiple') : t('scheme.locate.none')}</p>
      {state.candidates.map(candidate => <button type="button" key={candidate} onClick={() => onChooseGameRoot(candidate)}>{candidate}</button>)}
      <Button variant="primary" onClick={onChooseFolder}>{t('scheme.locate.chooseFolder')}</Button>
      <div className="ki-dialog-actions"><Button data-safe-focus onClick={onCancel}>{t('import.cancel')}</Button></div>
    </div> : null}
    {busy ? <p role="status">{t(state.phase === 'locating' ? 'profile.apply.locating' : 'profile.apply.planning')}</p> : null}
    {profile && (state.phase === 'ready' || applying || unresolved) ? <>
      <p>{t('profile.row.component', { label: t('profile.label.scheme'), summary: describeFile('scheme', profile.scheme, current, t) })}</p>
      <p>{t('profile.label.audio')}</p>
      <ul className="pr-apply-events">{AUDIO_EVENTS.map(event => <li key={event}>{t('profile.eventSounds', { event: eventLabel(event, t), names: describeEvent(event, profile.audio, current, t) })}</li>)}</ul>
      <p className="ws-note">{t('profile.apply.note.closeGame')}</p>
      <p className="ws-note">{t('profile.apply.note.backup')}</p>
    </> : null}
    {state.error ? <Notice tone={unresolved ? 'warning' : 'error'}><p>{msg(state.error)}</p></Notice> : null}
    {unresolved ? <div className="ki-dialog-actions">
      <Button variant="primary" onClick={onReconcile}>{t('profile.apply.reconcile')}</Button>
    </div> : state.phase === 'ready' || applying ? <div className="ki-dialog-actions">
      <Button data-safe-focus disabled={applying} onClick={onCancel}>{t('import.cancel')}</Button>
      {state.canConfirm ? <Button variant="primary" disabled={applying} onClick={onConfirm}>{applying ? t('profile.apply.working') : t('profile.apply.confirmButton')}</Button> : null}
    </div> : null}
  </Dialog>
}
