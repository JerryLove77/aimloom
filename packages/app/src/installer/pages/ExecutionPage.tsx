import { useLang, useT, type MessageKey } from '../../i18n';
import { executionErrorText } from '../issue';
import { ExecutionFiles } from '../components/ExecutionFiles';
import type { Job, Phase, Preview } from '../contracts';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
const phases: Record<Phase, MessageKey> = { preparing: 'installer.phase.preparing', protecting: 'installer.phase.protecting', installing: 'installer.phase.installing', verifying: 'installer.phase.verifying', restoring: 'installer.phase.restoring', 'rolling-back': 'installer.phase.rollingBack' };
export function ExecutionPage({ job, preview, busy, isDemo, onDone, onBackups, onOpenBackup, onReconcile }: {
  job: Job | null;
  preview: Preview | null;
  busy: boolean;
  isDemo: boolean;
  onDone: () => void;
  onBackups: () => void;
  onOpenBackup: () => void;
  onReconcile: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const running = job?.state === 'running';
  const unknown = job?.state === 'unknown';
  const result = job?.result;
  const outcome = result?.status;
  const success = outcome === 'completed' || outcome === 'restored' || outcome === 'no-change';
  const recovering = outcome === 'recovery-required';
  const preflight = job?.state === 'failed' && job.error && ['INVALID_PATH', 'INVALID_PACK', 'GAME_RUNNING', 'GAME_STATE_UNKNOWN', 'PLAN_STALE', 'PLAN_MISSING', 'BACKUP_INVALID', 'CONFLICT', 'UNOWNED_FILE', 'BUSY', 'UNSUPPORTED_PLATFORM'].includes(job.error.code);
  const title = t(running ? 'installer.exec.title.running' : unknown ? 'installer.exec.title.unknown' : outcome === 'completed' ? 'installer.exec.title.completed' : outcome === 'restored' ? 'installer.exec.title.restored' : outcome === 'no-change' ? 'installer.exec.title.noChange' : outcome === 'rolled-back' ? 'installer.exec.title.rolledBack' : recovering ? 'installer.exec.title.recovering' : preflight ? 'installer.exec.title.preflight' : job?.state === 'reconciled' ? 'installer.exec.title.reconciled' : 'installer.exec.title.incomplete');
  const progress = job?.progress;
  const determinate = progress?.total != null && progress.completed != null && progress.total > 0;
  return <><div className="ki-execution-panel ki-panel">
    <div className={`ki-result-mark ${success ? 'is-success' : running ? 'is-running' : 'is-warning'}`}>
      <Icon name={success ? 'check' : running ? 'install' : 'warning'} size={34} />
    </div>
    <span className="ki-overline">
      {t(isDemo ? 'installer.exec.overline.demo' : running ? 'installer.exec.overline.running' : success ? 'installer.exec.overline.success' : 'installer.exec.overline.attention')}
    </span>
    <h2>
      {title}
    </h2>
    {running ? <><p className="ki-execution-subtitle">{t('installer.exec.runningNote')}</p><div className="ki-progress-section">
      <div className="ki-progress-label">
        <strong role="status" aria-live="polite">
          {progress ? t(phases[progress.phase]) : t('installer.exec.waiting')}
        </strong>
        {determinate ? <span>{t('installer.exec.processed', { completed: progress.completed!, total: progress.total! })}</span> : <span>{t('installer.exec.processing')}</span>}
      </div>
      {determinate ? <progress max={progress.total!} value={progress.completed!} aria-label={t('installer.exec.progressAria')} /> : <progress aria-label={t('installer.exec.indeterminateAria')} />}
      <ol className="ki-execution-stages">
        {(['preparing', 'protecting', preview?.kind === 'restore' ? 'restoring' : 'installing', 'verifying'] as Phase[]).map((phase, i) => <li key={phase} aria-current={phase === progress?.phase ? 'step' : undefined}>
          <span>
            {i + 1}
          </span>
          {t(phases[phase])}
        </li>)}
      </ol>
      {progress?.currentFile ? <code className="ki-current-file">
        {progress.currentFile}
      </code> : null}
    </div></> : unknown ? <><p className="ki-execution-subtitle">{t('installer.exec.unknownNote')}</p><Button variant="primary" disabled={busy} onClick={onReconcile}>
      {t(busy ? 'installer.checking' : 'installer.checkResult')}
    </Button></> : <><p className="ki-execution-subtitle">
      {t(outcome === 'completed' ? 'installer.exec.note.completed' : outcome === 'restored' ? 'installer.exec.note.restored' : outcome === 'no-change' ? 'installer.exec.note.noChange' : outcome === 'rolled-back' ? 'installer.exec.note.rolledBack' : recovering ? 'installer.exec.note.recovering' : job?.state === 'reconciled' ? 'installer.exec.note.reconciled' : 'installer.exec.note.other')}
    </p>{result ? <div className="ki-result-facts">
      <div>
        <strong>
          {result.items.length}
        </strong>
        <span>{t('installer.exec.filesRecorded')}</span>
      </div>
      <div>
        <strong>
          {result.errors.length}
        </strong>
        <span>{t('installer.exec.errors')}</span>
      </div>
    </div> : null}{result?.batchId ? <div className="ki-result-batch">
      <span>{t('installer.exec.batchId')}</span>
      <code>
        {result.batchId}
      </code>
    </div> : null}{result?.errors.length ? <Notice tone="error">
      <ul>
        {result.errors.map((error, i) => <li key={i}>
          {executionErrorText(lang, error, result.errorsEn?.[i])}
        </li>)}
      </ul>
    </Notice> : null}{result?.items.length ? <ExecutionFiles items={result.items} /> : null}<div className="ki-result-actions">
        <Button variant="primary" onClick={recovering || job?.state === 'reconciled' ? onBackups : onDone}>
          {t(recovering ? 'installer.exec.goRecover' : job?.state === 'reconciled' ? 'installer.exec.viewRecords' : success ? 'installer.exec.done' : 'installer.exec.adjust')}
        </Button>
        {success || outcome === 'rolled-back' ? <Button onClick={onBackups}>{t('installer.exec.viewBackups')}</Button> : null}
        {result?.batchId ? <Button variant="ghost" onClick={onOpenBackup}>{t('installer.openBackupFolder')}<Icon name="folder" size={16} /></Button> : null}
      </div></>}
    {preview?.location.backupRoot ? <div className="ki-execution-backup">
      <Icon name="shield" size={17} />
      <div>
        <span>{t('installer.backupLocation')}</span>
        <code>
          {preview.location.backupRoot}
        </code>
      </div>
    </div> : null}
  </div></>;
}
