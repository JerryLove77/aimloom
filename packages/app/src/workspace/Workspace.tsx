import { useCallback, useEffect, useRef, useState } from 'react'
import { InstallerApp } from '../installer/InstallerApp'
import { ProfilesApp } from '../profiles/ProfilesApp'
import { SchemePage } from '../scheme/SchemePage'
import { AudioPage } from '../audio/AudioPage'
import { CrosshairPage } from '../crosshair/CrosshairPage'
import { EnemyPage } from '../enemy/EnemyPage'
import { isAnyDialogOpen } from '../installer/components/Dialog'
import { SettingsState, WorkspaceStatus, type SettingsStorage, type WorkspaceSection } from './WorkspaceShell'
import { ReportSheet } from './ReportSheet'
import { createReportController } from './report-controller'
import { readAccount } from './account'
import { resolveGameRoot } from './game-root'
import { noFileDrops, type FileDropSource } from './file-drop'
import { browserStorage, useLang } from '../i18n'
import { readUpdatesEnabled } from './updates'
import { readBetaEnabled, writeBetaEnabled } from './beta'
import type { AppInfo, InstallerBridge, UpdateCheck } from '../installer/contracts'
import type { ProfileBridge } from '../profiles/bridge'
import type { ProfileAssetBridge } from '../profiles/assets'

/** The five-section workspace. Every page stays mounted so drafts and pending choices survive switching. */
export function Workspace({ bridge, profileBridge, assetBridge, isDemo, fileDrops = noFileDrops, storage = browserStorage() }: {
  bridge: InstallerBridge; profileBridge: ProfileBridge; assetBridge: ProfileAssetBridge; isDemo: boolean
  /** Files dragged in from outside. Every page gets the one source; only the active section reacts, and the legacy installer takes none. */
  fileDrops?: FileDropSource
  /** The Settings popover's storage for the remembered account and the updates switch. Injectable for tests, browserStorage() otherwise. */
  storage?: SettingsStorage
}) {
  const [installer, setInstaller] = useState(false)
  const [section, setSection] = useState<WorkspaceSection>('profile')
  const [profileUnsaved, setProfileUnsaved] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [update, setUpdate] = useState<UpdateCheck | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  // Null until `appInfo` has answered: the switch's own default (on for a beta build, off
  // otherwise) is not known before then, so the update check waits rather than guessing off.
  const [betaOn, setBetaOnState] = useState<boolean | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  // Lives for the whole session, not per mount of the sheet: closing (Cancel/Esc) must keep the
  // draft, so the controller cannot be recreated the next time the sheet opens (ruling B3).
  const [reportController] = useState(() => createReportController(bridge))
  const { lang, choice } = useLang()
  // The sidebar dot is a launch notification, not a standing indicator of "update.newer": once
  // the player has opened Settings once this session, it has done its job and stays gone even
  // after the popover closes again. "Session" is this component's own lifetime -- nothing is
  // persisted, so the dot returns on the next launch if the version is still newer.
  const [everOpened, setEverOpened] = useState(false)
  // `installer_app_info` never fails, but a demo/test bridge is free to reject it, so this still
  // falls back rather than leaving the beta switch stuck at "unknown" forever.
  useEffect(() => {
    let cancelled = false
    bridge.appInfo()
      .then(info => { if (cancelled) return; setAppInfo(info); setBetaOnState(readBetaEnabled(storage, info.channel === 'beta')) })
      .catch(() => { if (cancelled) return; setAppInfo({ label: '', channel: 'stable' }); setBetaOnState(readBetaEnabled(storage, false)) })
    return () => { cancelled = true }
  }, [bridge, storage])
  const setBetaOn = (on: boolean) => { setBetaOnState(on); writeBetaEnabled(storage, on) }

  useEffect(() => {
    if (!readUpdatesEnabled(storage)) return
    if (betaOn === null) return // the build's channel (and so the switch's default) is not known yet
    let cancelled = false
    bridge.updateCheck(betaOn)
      .then(result => { if (!cancelled) setUpdate(result) })
      .catch(() => { if (!cancelled) setUpdate({ latest: null, newer: false, channel: 'stable' }) })
    return () => { cancelled = true }
    // Re-runs whenever the beta switch changes, by design (beta channel design §4).
  }, [bridge, storage, betaOn])
  // Whether the game was actually found, for the report's `game.found` -- never "a folder is
  // remembered", which a stale remembered folder for an uninstalled game would turn into a false
  // "yes", and a player who only used Quick import (nothing remembered yet) into a false "no".
  // `resolveGameRoot` runs discovery and validates through `locate`. Refreshed once at launch and
  // again whenever a report is about to be opened, so a report always reflects a recent check.
  const [gameFound, setGameFound] = useState(false)
  // Only the latest check may answer: a slow launch-time check must not overwrite the fresher one
  // started when the report sheet opened.
  const gameCheck = useRef(0)
  const checkGame = useCallback(() => {
    const mine = ++gameCheck.current
    resolveGameRoot(bridge, storage).then(result => { if (mine === gameCheck.current) setGameFound(result.gameRoot !== null) }).catch(() => {})
  }, [bridge, storage])
  useEffect(() => {
    checkGame()
    return () => { gameCheck.current++ }
  }, [checkGame])
  const open = () => setInstaller(true)
  // Refuses over another sheet (a page's own ImportSheet/ResourceSheet/etc., or this one already
  // open) rather than stacking dialogs; the Settings button is already unreachable in that case
  // (WorkspaceShell disables it via `useAnyDialogOpen`), so this is a second, defensive guard.
  const openReport = () => {
    if (isAnyDialogOpen()) return
    setReportOpen(true)
    checkGame()
  }
  const updateDot = update?.newer === true && !everOpened
  const rootOverlay = reportOpen ? <ReportSheet
    controller={reportController}
    account={readAccount(storage)}
    langChoice={choice}
    lang={lang}
    gameFound={gameFound}
    onOpenLogs={bridge.openLogs.bind(bridge)}
    onClose={() => setReportOpen(false)}
  /> : null
  return <WorkspaceStatus.Provider value={{ profileUnsaved }}>
    <SettingsState.Provider value={{
      anchor, open: (a: HTMLElement) => { setAnchor(a); setEverOpened(true) }, close: () => { const a = anchor; setAnchor(null); a?.focus() },
      storage, accountResolve: bridge.accountResolve.bind(bridge), openLogs: bridge.openLogs.bind(bridge), openDownload: bridge.openDownload.bind(bridge), openExplore: bridge.openExplore.bind(bridge),
      update, updateDot, appInfo, betaOn: betaOn ?? false, setBetaOn, openReport, rootOverlay,
    }}>
      <ProfilesApp bridge={profileBridge} assets={assetBridge} locate={bridge} isDemo={isDemo} isActive={!installer && section === 'profile'} onSelectSection={setSection} onOpenInstaller={open} onDirtyChange={setProfileUnsaved} fileDrops={fileDrops} />
      <SchemePage bridge={bridge} assets={assetBridge} isDemo={isDemo} isActive={!installer && section === 'scheme'} section={section} onSelect={setSection} onOpenInstaller={open} fileDrops={fileDrops} />
      <AudioPage bridge={bridge} assets={assetBridge} isDemo={isDemo} isActive={!installer && section === 'audio'} section={section} onSelect={setSection} onOpenInstaller={open} fileDrops={fileDrops} />
      <CrosshairPage bridge={bridge} assets={assetBridge} isDemo={isDemo} isActive={!installer && section === 'crosshair'} section={section} onSelect={setSection} onOpenInstaller={open} fileDrops={fileDrops} />
      <EnemyPage bridge={bridge} isDemo={isDemo} isActive={!installer && section === 'enemy'} section={section} onSelect={setSection} onOpenInstaller={open} fileDrops={fileDrops} />
      {installer ? <InstallerApp bridge={bridge} isDemo={isDemo} onBackToProfiles={() => setInstaller(false)} onSendReport={openReport} onOpenLogs={bridge.openLogs.bind(bridge)} overlays={rootOverlay} /> : null}
    </SettingsState.Provider>
  </WorkspaceStatus.Provider>
}
