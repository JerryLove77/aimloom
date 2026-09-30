import { useContext } from 'react'
import { Button } from '../ui/Button'
import { Toast, useToast } from '../ui/status'
import { SettingsState, WorkspaceShell, type WorkspaceSection } from '../workspace/WorkspaceShell'
import { noFileDrops, useFileDrop, type FileDropSource } from '../workspace/file-drop'
import { useLang, useT } from '../i18n'
import type { ExploreKind } from '../bridge/contracts'
import './explore.css'

const KINDS: ExploreKind[] = ['theme', 'sound', 'crosshair']
/** Bar heights, in px, of the Sounds thumbnail's waveform. */
const WAVE = [10, 22, 34, 18, 28, 12, 24]

/**
 * Explore (APP-NAV, v0.1.6): what a player gets from elsewhere. Two ways in: Quick import, which
 * opens unchanged, and the website's explorer, which opens in the browser. A config pack folder
 * dropped anywhere on this page opens Quick import with that folder filled in. Browsing the
 * catalog inside the App comes later (ROADMAP APP-EXPLORE).
 */
export function ExplorePage({ isDemo = false, isActive = true, section, onSelect, onOpenInstaller, fileDrops = noFileDrops }: {
  isDemo?: boolean
  isActive?: boolean
  section: WorkspaceSection
  onSelect: (section: WorkspaceSection) => void
  /** Opens Quick import; with a path, that folder is its config pack. */
  onOpenInstaller: (packRoot?: string) => void
  /** Files dragged in from outside the app. This page takes a config pack folder. */
  fileDrops?: FileDropSource
}) {
  const t = useT()
  const { lang } = useLang()
  const { openExplore } = useContext(SettingsState)
  const { toast, tone, hide, show } = useToast(null)
  const dropHint = useFileDrop(fileDrops, { section: 'explore', active: isActive, busy: false, onRefused: show, onFile: path => onOpenInstaller(path) })
  if (!isActive) return null
  return (
    <WorkspaceShell overlays={<Toast message={toast} tone={tone} onDone={hide} />} dropHint={dropHint} active={section} onSelect={onSelect} isDemo={isDemo}
      eyebrow={t('explore.eyebrow')} title={t('explore.title')} scope={t('explore.scope')}>
      <div className="ws-explore">
        <section className="ws-explore-card" aria-labelledby="ws-explore-quick">
          {/* Decorative: the whole window takes the drop, and the button below is the keyboard route. */}
          <div className="ws-explore-art ws-explore-drop" aria-hidden="true">
            <span className="ws-explore-files"><span /><span /></span>
            <span>{t('explore.quick.drop')}</span>
          </div>
          <h2 id="ws-explore-quick">{t('explore.quick.title')}</h2>
          <p>{t('explore.quick.body')}</p>
          <div><Button variant="primary" onClick={() => onOpenInstaller()}>{t('explore.quick.open')}</Button></div>
        </section>
        <section className="ws-explore-card" aria-labelledby="ws-explore-web">
          <div className="ws-explore-art ws-explore-kinds" aria-hidden="true">
            {KINDS.map(kind => <span key={kind} className={`ws-explore-kind ws-explore-kind-${kind}`}>
              <i>{kind === 'sound' ? WAVE.map((height, index) => <b key={index} style={{ height }} />) : null}</i>
              <span>{t(`explore.web.kind.${kind}`)}</span>
            </span>)}
          </div>
          <h2 id="ws-explore-web">{t('explore.web.title')} <span className="ws-explore-host">aimloom.dev ↗</span></h2>
          <p>{t('explore.web.body')}</p>
          {/* Opening a browser is best effort, as for the explore links under each section's list. */}
          <div><Button onClick={() => { openExplore(lang, 'theme').catch(() => {}) }}>{t('explore.web.open')}</Button></div>
        </section>
      </div>
    </WorkspaceShell>
  )
}
