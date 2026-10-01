import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { InstallerBridge } from '../bridge/contracts';
import { useMsg, useT } from '../i18n';
import { installerIssueMsg } from './issue';
import { createInstallerController } from './controller';
import { createInitialState, hasPendingBackup, type Route } from './state';
import { canLeaveOperation, installUnloadGuard } from './window-lifecycle';
import { Button } from '../ui/Button';
import { Icon, TargetMark } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { Dialog } from '../ui/Dialog';
import { ConflictDialog } from './components/ConflictDialog';
import { ReviewPage } from './pages/ReviewPage';
import { ExecutionPage } from './pages/ExecutionPage';
import { RestorePage } from './pages/RestorePage';
import { HelpPage } from './pages/HelpPage';
import '../ui/tokens.css';
import './styles.css';
/**
 * 备份与恢复 and its help, opened from Explore's third card (beta2). The install wizard that
 * lived here was replaced by Quick import on Explore (`explore/`).
 */
export function InstallerApp({ bridge, isDemo = false, onBack, onGameChanged, onSendReport, onOpenLogs, overlays }: {
  bridge: InstallerBridge;
  isDemo?: boolean;
  /** Returns to Explore, where this page is opened from. */
  onBack?: () => void;
  /** A restore completed or its unknown result was checked: the sections' lists are stale. */
  onGameChanged?: () => void;
  /**
   * Help page Feedback block (spec §2.3): Quick import has no Settings button, so `Workspace`
   * hands these down directly instead of through `SettingsState`. Absent in a standalone render
   * (tests, or `InstallerApp` reached some other way) — the block then omits the actions it
   * cannot perform rather than showing dead buttons.
   */
  onSendReport?: () => void;
  onOpenLogs?: () => Promise<void>;
  /**
   * `Workspace`'s report sheet (`SettingsState.rootOverlay`), rendered here because while
   * Quick import is open every section page returns `null` — no `WorkspaceShell` is
   * mounted anywhere to hold it. Rendered inside `.kvk-installer` so the sheet's styles resolve
   * the same `--ki-*` tokens as every other dialog in this root.
   */
  overlays?: ReactNode;
}) {
  const t = useT();
  const msg = useMsg();
  const controller = useMemo(() => createInstallerController(bridge, { ...createInitialState(), isDemo }), [bridge, isDemo]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [conflict, setConflict] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const lifecycle = useMemo(() => ({ mounts: 0, discovered: false }), [controller]);
  useEffect(() => {
    lifecycle.mounts++;
    if (!lifecycle.discovered) {
      lifecycle.discovered = true;
      void controller.discover().then(() => { if (controller.getState().gameRoot) return controller.refreshBackups(); });
    }
    const removeGuard = installUnloadGuard(() => controller.getState().job);
    return () => {
      removeGuard();
      lifecycle.mounts--;
      queueMicrotask(() => {
        if (lifecycle.mounts === 0)
          controller.dispose();
      });
    };
  }, [controller, lifecycle]);
  useEffect(() => {
    if (main.current)
      main.current.scrollTop = 0; document.documentElement.scrollTop = 0; heading.current?.focus({ preventScroll: true });
  }, [state.route, state.step]);
  useEffect(() => {
    if (state.issue?.code === 'INVALID_PATH')
      document.querySelector<HTMLInputElement>('.kvk-installer input[aria-invalid="true"]')?.focus();
  }, [state.issue]);
  useEffect(() => { const blocked = () => setCloseWarning(true); window.addEventListener('kvk-close-blocked', blocked); return () => window.removeEventListener('kvk-close-blocked', blocked); }, []);
  const finishedJob = state.job && (state.job.state === 'reconciled' || (state.job.state === 'finished' && state.job.result?.status === 'completed')) ? state.job.operationId : null;
  useEffect(() => { if (finishedJob) onGameChanged?.(); }, [finishedJob]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = !canLeaveOperation(state.job);
  const preview = state.preview;
  const execution = state.route !== 'help' && state.step === 4 && state.job !== null;
  const changeRoute = (route: Route) => {
    controller.goTo(route, route === 'help' ? state.step : 1);
    if (route === 'restore' && controller.getState().gameRoot)
      void controller.refreshBackups();
  };
  const confirm = () => {
    if (preview?.kind === 'restore' && preview.rows.some(r => r.conflict || r.unowned))
      setConflict(true);
    else
      void controller.execute(false);
  };
  const refresh = () => { if (state.selectedBackupId) void controller.previewRestore(state.selectedBackupId); };
  const stale = state.issue?.code === 'PLAN_STALE' || state.issue?.code === 'PLAN_MISSING';
  const status = state.location?.gameState;
  const gameLabel = t(status === 'closed' ? 'installer.game.closed' : status === 'running' ? 'installer.game.running' : 'installer.game.unknown');
  const title = t(state.route === 'help' ? 'installer.title.help' : execution ? 'installer.title.execution' : state.step === 3 && preview ? 'installer.title.restoreReview' : 'installer.title.restore');
  const description = t(state.route === 'help' ? 'installer.desc.help' : execution ? 'installer.desc.execution' : state.step === 3 ? 'installer.desc.restoreReview' : 'installer.desc.restore');
  return <div className="kvk-installer">
    <header className="ki-topbar">
      {onBack ? <Button variant="ghost" disabled={locked || state.busy} onClick={onBack}>{t('installer.backToExplore')}</Button> : null}
      <div className="ki-brand">
        <TargetMark />
        <div>
          <strong>Aimloom</strong>
          <small>{t('installer.brand.subtitle')}</small>
        </div>
      </div>
      <div className="ki-topbar-right">
        {isDemo ? <span className="ki-demo-badge">{t('installer.demoBadge')}</span> : null}
        <span className={`ki-game-state ki-game-${status ?? 'unknown'}`}>
          <span aria-hidden="true" />
          {gameLabel}
        </span>
      </div>
    </header>
    <div className="ki-workspace">
      <aside className="ki-sidebar">
        <nav aria-label={t('installer.nav.aria')}>
          {(['restore', 'help'] as Route[]).map(route => <div key={route}>
            <button type="button" className="ki-nav-button" aria-current={state.route === route ? 'page' : undefined} disabled={locked || state.busy} onClick={() => changeRoute(route)}>
              <Icon name={route} />
              {t(route === 'restore' ? 'installer.nav.restore' : 'installer.nav.help')}
              {route === 'restore' && hasPendingBackup(state.backupIndex) ? <span className="ki-nav-attention" aria-label={t('installer.nav.attention')}>!</span> : null}
            </button>
          </div>)}
        </nav>
        <div className="ki-sidebar-bottom">
          <Icon name="shield" size={16} />
          <span>{t('installer.sidebar.note')}</span>
          <small>v{__APP_VERSION__}</small>
        </div>
      </aside>
      <main ref={main} className="ki-main">
        <div className="ki-page-heading">
          <span className="ki-overline">
            {t(state.route === 'restore' ? 'installer.overline.restore' : 'installer.overline.help')}
          </span>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p>
            {description}
          </p>
          <span className="ki-heading-accent" aria-hidden="true" />
        </div>
        {state.issue ? <Notice tone="error" title={state.issue.code === 'PLAN_STALE' ? t('installer.issue.staleTitle') : state.issue.code === 'RECOVERY_REQUIRED' ? t('installer.issue.recoveryTitle') : undefined}>
          <p>
            {msg(installerIssueMsg(state.issue))}
          </p>
          {state.issue.path ? <code>
            {state.issue.path}
          </code> : null}
          {stale && state.selectedBackupId ? <Button onClick={refresh} disabled={state.busy}>{t('installer.refreshPlan')}</Button> : null}
        </Notice> : null}
        {status === 'running' && !execution ? <Notice tone="warning">
          <p>{t('installer.gameRunningNotice')}</p>
        </Notice> : null}
        {execution ? <ExecutionPage job={state.job} preview={preview} busy={state.busy} isDemo={isDemo} onDone={() => changeRoute('restore')} onBackups={() => changeRoute('restore')} onOpenBackup={() => void controller.openBackup()} onReconcile={() => void controller.reconcile()} /> : state.route === 'help' ? <HelpPage onSendReport={onSendReport} onOpenLogs={onOpenLogs} /> : state.step === 3 && preview?.kind === 'restore' ? <ReviewPage preview={preview} busy={state.busy} blocked={!!stale || preview.location.gameState !== 'closed'} onBack={() => controller.goTo('restore', 1)} onConfirm={confirm} onRefresh={refresh} /> : <RestorePage state={state} controller={controller} onGoImport={onBack} />}
      </main>
    </div>
    <ConflictDialog open={conflict} rows={preview?.rows ?? []} onClose={() => setConflict(false)} onConfirm={() => { setConflict(false); void controller.execute(true); }} />
    <Dialog open={closeWarning} title={t('installer.closeWarning.title')} onClose={() => setCloseWarning(false)}>
      <p>{t('installer.closeWarning.body')}</p>
      <div className="ki-dialog-actions">
        <Button data-safe-focus variant="primary" onClick={() => setCloseWarning(false)}>{t('installer.closeWarning.keepOpen')}</Button>
        {state.job?.state === 'unknown' ? <Button onClick={() => { setCloseWarning(false); void controller.reconcile(); }}>{t('installer.checkResult')}</Button> : null}
      </div>
    </Dialog>
    {overlays}
  </div>;
}
