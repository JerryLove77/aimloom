import { plural, useLang, useT } from '../../i18n';
import type { InstallerState } from '../state';
import type { InstallerController } from '../controller';
import { BackupList } from '../components/BackupList';
import { Button } from '../components/Button';
import { PathField } from '../components/PathField';
import { Notice } from '../components/Notice';
import { Icon } from '../components/Icon';
export function RestorePage({ state, controller }: {
  state: InstallerState;
  controller: InstallerController;
}) {
  const t = useT();
  const { lang } = useLang()
  const { backupIndex, busy } = state;
  const pending = backupIndex?.records.some(b => ['prepared', 'applying', 'recovery-required'].includes(b.status));
  return <><div className="ki-panel ki-restore-location">
    <PathField label={t('installer.gameFolder')} value={state.gameRoot} onChange={controller.setGameRoot} onChoose={() => void controller.chooseFolder('game', lang)} hint={t('installer.restore.hint')} disabled={busy} />
    <Button onClick={() => void controller.locate()} disabled={busy || !state.gameRoot.trim()}>
      {t(busy ? 'installer.restore.reading' : 'installer.restore.read')}
    </Button>
  </div>{pending ? <Notice tone="warning" title={t('installer.restore.pendingTitle')}>
    <p>{t('installer.restore.pendingBody')}</p>
  </Notice> : null}{backupIndex && state.issue?.code !== 'BACKUP_INVALID' ? <div className="ki-restore-layout">
    <section>
      <div className="ki-section-title">
        <h2>{t('installer.restore.records')}</h2>
        <span>{t(plural(backupIndex.records.length, 'installer.restore.recordCount'), { count: backupIndex.records.length })}</span>
      </div>
      {backupIndex.records.length ? <BackupList records={backupIndex.records} selectedId={state.selectedBackupId} busy={busy} onSelect={id => void controller.previewRestore(id)} /> : <div className="ki-panel ki-empty">
        <Icon name="restore" size={30} />
        <strong>{t('installer.restore.emptyTitle')}</strong>
        <p>{t('installer.restore.emptyBody')}</p>
        <Button onClick={() => controller.goTo('install', 1)}>{t('installer.restore.goInstall')}</Button>
      </div>}
    </section>
    <aside className="ki-pristine ki-panel">
      <Icon name="shield" size={28} />
      <h2>{t('installer.restore.pristineTitle')}</h2>
      <p>{t('installer.restore.pristineBody')}</p>
      <Button disabled={busy || !backupIndex.hasPristine || pending} onClick={() => void controller.previewRestore('pristine')}>{t('installer.restore.pristineReview')}</Button>
      {!backupIndex.hasPristine ? <small>{t('installer.restore.noPristine')}</small> : pending ? <small>{t('installer.restore.finishPending')}</small> : null}
      <div className="ki-summary-rule" />
      <span className="ki-muted">{t('installer.restore.backupRoot')}</span>
      <code>
        {backupIndex.location.backupRoot}
      </code>
      <Button variant="ghost" onClick={() => void controller.openBackup()}>{t('installer.openBackupFolder')}<Icon name="folder" size={16} /></Button>
    </aside>
  </div> : <div className="ki-empty ki-restore-empty">
    <Icon name="restore" size={32} />
    <strong>{t('installer.restore.introTitle')}</strong>
    <p>{t('installer.restore.introBody')}</p>
  </div>}</>;
}
