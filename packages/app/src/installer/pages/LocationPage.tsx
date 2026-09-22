import { useMsg, useT } from '../../i18n';
import { installerIssueMsg } from '../issue';
import type { Discovery, Issue, Location } from '../contracts';
import { PathField } from '../components/PathField';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
export function LocationPage({ gameRoot, packRoot, location, discovery, issue, busy, onGame, onPack, onChoose, onNext }: {
  gameRoot: string;
  packRoot: string;
  location: Location | null;
  discovery: Discovery | null;
  issue: Issue | null;
  busy: boolean;
  onGame: (v: string) => void;
  onPack: (v: string) => void;
  onChoose: (kind: 'game' | 'pack') => void;
  onNext: () => void;
}) {
  const t = useT();
  const msg = useMsg();
  return <><div className="ki-location-layout">
    <div className="ki-panel ki-location-panel">
      <div className="ki-panel-label">{t('installer.location.label')}</div>
      <PathField label={t('installer.gameFolder')} value={gameRoot} onChange={onGame} onChoose={() => onChoose('game')} disabled={busy} hint={t('installer.location.gameHint')} error={issue?.code === 'INVALID_PATH' ? msg(installerIssueMsg(issue)) : undefined} />
      {discovery && discovery.candidates.length > 1 ? <fieldset className="ki-candidates">
        <legend>{t('installer.location.candidates')}</legend>
        {discovery.candidates.map(path => <label key={path}>
          <input type="radio" name="game-candidate" checked={gameRoot === path} onChange={() => onGame(path)} disabled={busy} />
          <code>
            {path}
          </code>
        </label>)}
      </fieldset> : null}
      <div className="ki-path-divider" />
      <PathField label={t('installer.location.pack')} value={packRoot} onChange={onPack} onChoose={() => onChoose('pack')} disabled={busy} hint={t('installer.location.packHint')} error={issue?.code === 'INVALID_PACK' ? msg(installerIssueMsg(issue)) : undefined} />
      <div className="ki-location-status">
        <Icon name={location ? 'check' : 'search'} size={16} />
        {t(busy ? 'installer.location.status.checking' : location ? 'installer.location.status.confirmed' : gameRoot ? 'installer.location.status.onContinue' : discovery ? 'installer.location.status.notFound' : 'installer.location.status.detecting')}
      </div>
    </div>
    <aside className="ki-how-it-works">
      <span className="ki-overline">{t('installer.location.aside.overline')}</span>
      <h2>{t('installer.location.aside.line1')}<br />{t('installer.location.aside.line2')}</h2>
      <ol>
        <li>
          <span>1</span>
          <div>
            <strong>{t('installer.location.aside.step1')}</strong>
            <p>{t('installer.location.aside.step1Body')}</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>{t('installer.location.aside.step2')}</strong>
            <p>{t('installer.location.aside.step2Body')}</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>{t('installer.location.aside.step3')}</strong>
            <p>{t('installer.location.aside.step3Body')}</p>
          </div>
        </li>
      </ol>
      <div className="ki-quiet-note">
        <Icon name="shield" />
        <p>{t('installer.location.kept')}<br /><span>{t('installer.location.keptList')}</span></p>
      </div>
    </aside>
  </div><footer className="ki-footer">
      <span>{t('installer.location.footer')}</span>
      <Button variant="primary" disabled={busy || !gameRoot.trim() || !packRoot.trim()} onClick={onNext}>
        {t(busy ? 'installer.checking' : 'installer.location.next')}
        <Icon name="arrow" size={17} />
      </Button>
    </footer></>;
}
