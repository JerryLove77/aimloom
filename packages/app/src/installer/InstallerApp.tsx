import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { InstallerBridge } from './contracts';
import { useLang, useMsg, useT, type MessageKey } from '../i18n';
import { installerIssueMsg } from './issue';
import { createInstallerController } from './controller';
import { createInitialState, hasPendingBackup, type Route, type Step } from './state';
import { canLeaveOperation, installUnloadGuard } from './window-lifecycle';
import { Button } from './components/Button';
import { Icon, TargetMark } from './components/Icon';
import { StepRail } from './components/StepRail';
import { Notice } from './components/Notice';
import { Dialog } from './components/Dialog';
import { ConflictDialog } from './components/ConflictDialog';
import { LocationPage } from './pages/LocationPage';
import { SelectionPage } from './pages/SelectionPage';
import { ReviewPage } from './pages/ReviewPage';
import { ExecutionPage } from './pages/ExecutionPage';
import { RestorePage } from './pages/RestorePage';
import { HelpPage } from './pages/HelpPage';
import './tokens.css';
import './styles.css';
const titles: MessageKey[] = ['installer.title.location', 'installer.title.selection', 'installer.title.review', 'installer.title.execution'];
const descriptions: MessageKey[] = ['installer.desc.location', 'installer.desc.selection', 'installer.desc.review', 'installer.desc.execution'];
export function InstallerApp({ bridge, isDemo = false, onBackToProfiles, onSendReport, onOpenLogs, overlays }: {
  bridge: InstallerBridge;
  isDemo?: boolean;
  onBackToProfiles?: () => void;
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
  const { lang } = useLang()
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
      void controller.discover();
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
    if (state.issue?.code === 'INVALID_PATH' || state.issue?.code === 'INVALID_PACK')
      document.querySelector<HTMLInputElement>('.kvk-installer input[aria-invalid="true"]')?.focus();
  }, [state.issue]);
  useEffect(() => { const blocked = () => setCloseWarning(true); window.addEventListener('kvk-close-blocked', blocked); return () => window.removeEventListener('kvk-close-blocked', blocked); }, []);
  const locked = !canLeaveOperation(state.job);
  const preview = state.preview;
  const execution = state.route !== 'help' && state.step === 4 && state.job !== null;
  const changeRoute = (route: Route) => {
    controller.goTo(route, route === 'help' ? state.step : 1);
    if (route === 'restore' && controller.getState().gameRoot)
      void controller.refreshBackups();
  };
  const nextLocation = async () => {
    await controller.locate();
    const current = controller.getState();
    if (!current.location || current.issue || current.route === 'restore')
      return;
    await controller.loadCatalog();
    if (controller.getState().catalog && !controller.getState().issue)
      controller.goTo('install', 2);
  };
  const confirm = () => {
    if (preview?.kind === 'restore' && preview.rows.some(r => r.conflict || r.unowned))
      setConflict(true);
    else
      void controller.execute(false);
  };
  const refresh = () => state.route === 'restore' && state.selectedBackupId ? void controller.previewRestore(state.selectedBackupId) : void controller.previewInstall();
  const stale = state.issue?.code === 'PLAN_STALE' || state.issue?.code === 'PLAN_MISSING';
  const status = state.location?.gameState;
  const gameLabel = t(status === 'closed' ? 'installer.game.closed' : status === 'running' ? 'installer.game.running' : 'installer.game.unknown');
  const title = t(state.route === 'help' ? 'installer.title.help' : execution ? 'installer.title.execution' : state.route === 'restore' && state.step === 3 && preview ? 'installer.title.restoreReview' : state.route === 'restore' ? 'installer.title.restore' : titles[state.step - 1]!);
  const description = t(state.route === 'help' ? 'installer.desc.help' : execution ? 'installer.desc.execution' : state.route === 'restore' && state.step === 3 ? 'installer.desc.restoreReview' : state.route === 'restore' ? 'installer.desc.restore' : descriptions[state.step - 1]!);
  return <div className="kvk-installer">
    <header className="ki-topbar">
      {onBackToProfiles ? <Button variant="ghost" disabled={locked || state.busy} onClick={onBackToProfiles}>{t('installer.backToProfile')}</Button> : null}
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
          {(['install', 'restore', 'help'] as Route[]).map(route => <div key={route}>
            <button type="button" className="ki-nav-button" aria-current={state.route === route ? 'page' : undefined} disabled={locked || state.busy} onClick={() => changeRoute(route)}>
              <Icon name={route} />
              {t(route === 'install' ? 'installer.nav.install' : route === 'restore' ? 'installer.nav.restore' : 'installer.nav.help')}
              {route === 'restore' && hasPendingBackup(state.backupIndex) ? <span className="ki-nav-attention" aria-label={t('installer.nav.attention')}>!</span> : null}
            </button>
            {route === 'install' && state.route === 'install' ? <StepRail step={state.step} onStep={(step: Step) => controller.goTo('install', step)} disabled={locked || state.busy} canSelect={!!state.catalog && !!state.location} canReview={!!preview} /> : null}
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
            {state.route === 'install' ? t('installer.overline.install', { step: state.step }) : t(state.route === 'restore' ? 'installer.overline.restore' : 'installer.overline.help')}
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
          {stale && (state.route === 'install' || state.selectedBackupId) ? <Button onClick={refresh} disabled={state.busy}>{t('installer.refreshPlan')}</Button> : null}
        </Notice> : null}
        {status === 'running' && !execution ? <Notice tone="warning">
          <p>{t('installer.gameRunningNotice')}</p>
        </Notice> : null}
        {execution ? <ExecutionPage job={state.job} preview={preview} busy={state.busy} isDemo={isDemo} onDone={() => state.route === 'restore' ? changeRoute('restore') : controller.goTo('install', 1)} onBackups={() => changeRoute('restore')} onOpenBackup={() => void controller.openBackup()} onReconcile={() => void controller.reconcile()} /> : state.route === 'help' ? <HelpPage onSendReport={onSendReport} onOpenLogs={onOpenLogs} /> : state.route === 'restore' && !(state.step === 3 && preview?.kind === 'restore') ? <RestorePage state={state} controller={controller} /> : preview && state.step === 3 ? <ReviewPage preview={preview} busy={state.busy} blocked={!!stale || preview.location.gameState !== 'closed'} onBack={() => controller.goTo(state.route, state.route === 'restore' ? 1 : 2)} onConfirm={confirm} onRefresh={refresh} /> : state.step === 2 && state.route === 'install' ? <SelectionPage catalog={state.catalog} categories={state.categories} busy={state.busy} onChange={controller.setCategories} onBack={() => controller.goTo('install', 1)} onNext={() => void controller.previewInstall()} /> : <LocationPage gameRoot={state.gameRoot} packRoot={state.packRoot} location={state.location} discovery={state.discovery} issue={state.issue} busy={state.busy} onGame={controller.setGameRoot} onPack={controller.setPackRoot} onChoose={kind => void controller.chooseFolder(kind, lang)} onNext={() => void nextLocation()} />}
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
