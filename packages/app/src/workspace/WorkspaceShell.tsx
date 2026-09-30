import { createContext, useContext, useRef, type ReactNode, type Ref } from 'react'
import { Button } from '../ui/Button'
import { TargetMark } from '../ui/Icon'
import { useAnyDialogOpen } from '../ui/Dialog'
import { SettingsPopover } from './SettingsPopover'
import { updateAvailableKey } from './update-text'
import { useT, type Lang, type MessageKey } from '../i18n'
import type { FileDropHint } from './file-drop'
import type { AppInfo, EngineKind, EngineStatus, ExploreKind, SteamAccount, UpdateCheck } from '../bridge/contracts'
import './workspace.css'

/** The five sections under 更改配置 / Customize, then the Explore page. */
export type WorkspaceSection = 'profile' | 'scheme' | 'audio' | 'crosshair' | 'enemy' | 'explore'
export type CustomizeSection = Exclude<WorkspaceSection, 'explore'>
export const CUSTOMIZE_SECTIONS: CustomizeSection[] = ['profile', 'scheme', 'audio', 'crosshair', 'enemy']
export const WORKSPACE_SECTIONS: WorkspaceSection[] = [...CUSTOMIZE_SECTIONS, 'explore']
/** English reuses the approved nav wording (Background / Sounds / ... / Enemy look); Chinese keeps today's plain section names. */
const NAV_KEYS: Record<WorkspaceSection, MessageKey> = {
  profile: 'shell.nav.profile', scheme: 'shell.nav.scheme', audio: 'shell.nav.audio', crosshair: 'shell.nav.crosshair', enemy: 'shell.nav.enemy', explore: 'shell.nav.explore',
}
/**
 * Cross-section facts the sidebar shows. Only Profile's unsaved draft is surfaced (no pending
 * marker, by decision). `lastCustomize` is where the collapsed 更改配置 entry returns to.
 */
export const WorkspaceStatus = createContext<{ profileUnsaved: boolean; lastCustomize: CustomizeSection }>({ profileUnsaved: false, lastCustomize: 'profile' })
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
  /** The engine in use and whether it can be switched, asked each time Settings opens. */
  engineStatus(): Promise<EngineStatus>
  setEngine(engine: EngineKind): Promise<EngineStatus>
  /** After a switch every page must read again through the new engine: the real App reloads. */
  reloadWindow(): void
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
  engineStatus: () => Promise.resolve({ engine: 'powershell', blocked: null }),
  setEngine: engine => Promise.resolve({ engine, blocked: null }),
  reloadWindow: () => {},
  rootOverlay: null,
})

export function WorkspaceShell({ active, onSelect, isDemo, demoNote, overlays, dropHint, eyebrow, title, titleExtra, scope, headingRef, actions, actionNote, children }: {
  active: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  isDemo: boolean
  /** What the demo badge says on this page. Pages that do persist something say so themselves. */
  demoNote?: ReactNode
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
  const { profileUnsaved, lastCustomize } = useContext(WorkspaceStatus)
  const settings = useContext(SettingsState)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const t = useT()
  // A page's own sheet (ImportSheet, a Profile ResourceSheet, a crosshair add/replace sheet, the
  // report sheet itself...) is always a `Dialog`; while one is open the Settings button becomes
  // unreachable, so `Workspace.openReport` never has to open the report sheet over another one.
  const dialogOpen = useAnyDialogOpen()
  const customizing = active !== 'explore'
  const item = (section: WorkspaceSection, className?: string) => {
    const unsaved = section === 'profile' && profileUnsaved
    const label = t(NAV_KEYS[section])
    return <button type="button" key={section} className={className} aria-current={section === active ? 'page' : undefined}
      aria-label={unsaved ? t('shell.nav.unsavedLabel', { label }) : label} onClick={() => onSelect(section)}>
      {label}{unsaved ? <span className="ws-nav-unsaved" aria-hidden="true">{t('shell.unsaved')}</span> : null}
    </button>
  }
  return <div className="kvk-installer profiles-app">
    <div className="ws-window">
      <aside className="ws-sidebar">
        <div className="ws-brand"><TargetMark /><span>Aimloom</span></div>
        <nav aria-label={t('shell.nav.aria')}>
          {/* 更改配置 opens onto its five sections while one of them is active; from Explore it is
              one collapsed entry that returns to the section last used. */}
          {customizing
            ? <p className="ws-nav-top">{t('shell.nav.customize')}</p>
            : <button type="button" className="ws-nav-top" onClick={() => onSelect(lastCustomize)}
              aria-label={profileUnsaved ? t('shell.nav.unsavedLabel', { label: t('shell.nav.customize') }) : undefined}>
              {t('shell.nav.customize')}{profileUnsaved ? <span className="ws-nav-unsaved" aria-hidden="true">{t('shell.unsaved')}</span> : null}
            </button>}
          {customizing ? <div className="ws-nav-children">
            {item('profile')}
            <hr className="ws-nav-divider" />
            {(['scheme', 'audio', 'crosshair', 'enemy'] as const).map(section => item(section))}
          </div> : null}
          {item('explore', 'ws-nav-top')}
        </nav>
        <div className="ws-sidebar-bottom">
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
