import { createContext, useContext, useRef, type ReactNode, type Ref } from 'react'
import { Button } from '../installer/components/Button'
import { TargetMark } from '../installer/components/Icon'
import { useAnyDialogOpen } from '../installer/components/Dialog'
import { SettingsPopover } from './SettingsPopover'
import { updateAvailableKey } from './update-text'
import { useT, type Lang, type MessageKey } from '../i18n'
import type { FileDropHint } from './file-drop'
import type { AppInfo, ExploreKind, SteamAccount, UpdateCheck } from '../installer/contracts'
import './workspace.css'

export type WorkspaceSection = 'profile' | 'scheme' | 'audio' | 'crosshair' | 'enemy'
export const WORKSPACE_SECTIONS: WorkspaceSection[] = ['profile', 'scheme', 'audio', 'crosshair', 'enemy']
/** Sections with an implemented page. The rest stay visibly unavailable rather than hidden. */
export const WORKSPACE_READY: WorkspaceSection[] = WORKSPACE_SECTIONS
/** English reuses the approved nav wording (Background / Sounds / ... / Enemy look); Chinese keeps today's plain section names. */
const NAV_KEYS: Record<WorkspaceSection, MessageKey> = {
  profile: 'shell.nav.profile', scheme: 'shell.nav.scheme', audio: 'shell.nav.audio', crosshair: 'shell.nav.crosshair', enemy: 'shell.nav.enemy',
}
/** Cross-section facts the sidebar shows. Only Profile's unsaved draft is surfaced (no pending marker, by decision). */
export const WorkspaceStatus = createContext<{ profileUnsaved: boolean }>({ profileUnsaved: false })
/**
 * The Settings popover's open/closed state and the bridge access it needs, owned by Workspace
 * and read by whichever shell is mounted. `storage` is the same guarded accessor the account
 * and update-check settings are read/written through (browserStorage() by default in
 * Workspace, a fake in tests). The default value here is harmless no-ops so every existing test
 * that renders a page without a provider still passes.
 */
/** The account/updates storage the popover reads and writes: browserStorage() in the real app, a fake in tests. */
export type SettingsStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } | null

export const SettingsState = createContext<{
  anchor: HTMLElement | null
  open(anchor: HTMLElement): void
  close(): void
  storage: SettingsStorage
  accountResolve(url: string): Promise<SteamAccount>
  openLogs(): Promise<void>
  openDownload(lang: Lang, channel: 'stable' | 'beta'): Promise<void>
  openExplore(lang: Lang, kind: ExploreKind): Promise<void>
  update: UpdateCheck | null
  /** Whether the sidebar button should show its small dot: `update.newer` and the popover has not yet opened this session. */
  updateDot: boolean
  /** The App's own label and channel, from `installer_app_info`. Null only until the first answer lands. */
  appInfo: AppInfo | null
  /** The Join-the-beta switch's current value; changing it (via `setBetaOn`) re-runs the update check. */
  betaOn: boolean
  setBetaOn(on: boolean): void
  openReport(): void
  /**
   * The report sheet, built and owned by `Workspace`. Every page mounts its own `WorkspaceShell`
   * and only the active one is ever mounted, so the workspace root cannot pass this as an
   * `overlays` prop the way a page passes its own sheets; publishing it through this context and
   * rendering it beside `overlays` puts it inside the same `.kvk-installer` token wrapper as
   * every other sheet, whichever page is active.
   */
  rootOverlay: ReactNode
}>({
  anchor: null, open: () => {}, close: () => {}, storage: null,
  accountResolve: () => Promise.reject(new Error('no bridge')),
  openLogs: () => Promise.resolve(),
  openDownload: () => Promise.resolve(),
  openExplore: () => Promise.resolve(),
  update: null,
  updateDot: false,
  appInfo: null,
  betaOn: false,
  setBetaOn: () => {},
  openReport: () => {},
  rootOverlay: null,
})

export function WorkspaceShell({ active, onSelect, isDemo, demoNote, locked = false, onOpenInstaller, overlays, dropHint, eyebrow, title, titleExtra, scope, headingRef, actions, actionNote, children }: {
  active: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  isDemo: boolean
  /** What the demo badge says on this page. Pages that do persist something say so themselves. */
  demoNote?: ReactNode
  locked?: boolean
  onOpenInstaller?: (() => void) | undefined
  /** Dialogs render here, inside .kvk-installer, because their styles read its --ki-* tokens. */
  overlays?: ReactNode
  /** Shown while a file from outside hovers over the window. Decorative: the button beside it is the keyboard and screen-reader route. */
  dropHint?: FileDropHint | null | undefined
  eyebrow: string
  title: ReactNode
  titleExtra?: ReactNode
  scope: ReactNode
  headingRef?: Ref<HTMLHeadingElement>
  actions?: ReactNode
  actionNote?: ReactNode
  children: ReactNode
}) {
  const { profileUnsaved } = useContext(WorkspaceStatus)
  const settings = useContext(SettingsState)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const t = useT()
  // A page's own sheet (ImportSheet, a Profile ResourceSheet, a crosshair add/replace sheet, the
  // report sheet itself...) is always a `Dialog`; while one is open the Settings button becomes
  // unreachable, so `Workspace.openReport` never has to open the report sheet over another one.
  const dialogOpen = useAnyDialogOpen()
  const item = (section: WorkspaceSection) => {
    const unsaved = section === 'profile' && profileUnsaved
    const label = t(NAV_KEYS[section])
    return <button type="button" key={section} aria-current={section === active ? 'page' : undefined}
      aria-label={unsaved ? t('shell.nav.unsavedLabel', { label }) : label} onClick={() => onSelect(section)}>
      {label}{unsaved ? <span className="ws-nav-unsaved" aria-hidden="true">{t('shell.unsaved')}</span> : null}
    </button>
  }
  return <div className="kvk-installer profiles-app">
    <div className="ws-window">
      <aside className="ws-sidebar">
        <div className="ws-brand"><TargetMark /><span>Aimloom</span></div>
        <nav aria-label={t('shell.nav.aria')}>
          <p className="ws-group" aria-hidden="true">{t('shell.group.combinations')}</p>
          {item('profile')}
          <p className="ws-group" aria-hidden="true">{t('shell.group.current')}</p>
          {(['scheme', 'audio', 'crosshair', 'enemy'] as const).map(item)}
        </nav>
        <div className="ws-sidebar-bottom">
          {onOpenInstaller ? <Button variant="ghost" onClick={onOpenInstaller} disabled={locked}>{t('shell.installRestore')}</Button> : null}
          <Button variant="ghost" ref={settingsRef} disabled={dialogOpen} aria-haspopup="dialog" aria-expanded={settings.anchor === settingsRef.current && settings.anchor !== null}
            aria-label={settings.updateDot && settings.update?.latest != null
              ? `${t('settings.open')} — ${t(updateAvailableKey(settings.update), { version: settings.update.latest })}`
              : undefined}
            onClick={() => settingsRef.current && (settings.anchor === settingsRef.current ? settings.close() : settings.open(settingsRef.current))}>
            {t('settings.open')}
            {settings.updateDot ? <span className="ws-update-dot" aria-hidden="true" /> : null}
          </Button>
          <span className="ws-muted">{isDemo ? t('shell.env.demo') : t('shell.env.local')}</span>
        </div>
      </aside>
      <main className="ws-content">
        <header className="ws-header">
          <span className="ws-eyebrow">{eyebrow}</span>
          <div className="ws-title-row"><h1 ref={headingRef} tabIndex={-1}>{title}</h1>{titleExtra}</div>
          <p>{scope}</p>
        </header>
        <div className="ws-body">
          {isDemo ? <p className="ws-demo-note">{demoNote ?? t('shell.demoNote')}</p> : null}
          {children}
        </div>
        {actions ? <footer className="ws-action-bar"><span>{actionNote}</span><div>{actions}</div></footer> : null}
      </main>
    </div>
    {dropHint ? <div className={`ws-drop-overlay${dropHint.accepted ? '' : ' ws-drop-overlay-refused'}`} aria-hidden="true"><span>{dropHint.text}</span></div> : null}
    {overlays}
    {settings.anchor !== null && settings.anchor === settingsRef.current ? <SettingsPopover anchor={settings.anchor} onClose={settings.close} /> : null}
    {settings.rootOverlay}
  </div>
}
