import { Button } from '../ui/Button'
import { useLang, useT } from '../i18n'
import type { SectionPhase } from './controller'
import './locate.css'

/**
 * Finding the game folder, before a game-side section can list anything: the candidates
 * discovery found (or none) and the folder picker, or just the picker after an error.
 * Wording comes from `<section>.locate.{multiple,none,chooseFolder,chooseGameFolder}`.
 */
export function LocatePanel({ section, phase, candidates, locked, controller }: {
  section: 'theme' | 'audio' | 'enemy' | 'crosshair' | 'quick'
  phase: SectionPhase
  candidates: string[]
  locked: boolean
  controller: { chooseGameRoot(root: string): Promise<void>; chooseFolder(lang: 'zh' | 'en'): Promise<void> }
}) {
  const t = useT()
  const { lang } = useLang()
  if (phase === 'needs-location') return <div className="sc-locate">
    <p>{candidates.length ? t(`${section}.locate.multiple`) : t(`${section}.locate.none`)}</p>
    {candidates.map(candidate => <button type="button" className="sc-candidate" key={candidate} disabled={locked} onClick={() => void controller.chooseGameRoot(candidate)}>{candidate}</button>)}
    <Button variant="primary" disabled={locked} onClick={() => void controller.chooseFolder(lang)}>{t(`${section}.locate.chooseFolder`)}</Button>
  </div>
  if (phase === 'error') return <div className="sc-locate"><Button variant="primary" onClick={() => void controller.chooseFolder(lang)}>{t(`${section}.locate.chooseGameFolder`)}</Button></div>
  return null
}
