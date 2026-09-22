import { useContext } from 'react'
import { useLang, useT } from '../i18n'
import type { ExploreKind } from '../installer/contracts'
import { SettingsState } from './WorkspaceShell'

/**
 * The quiet line under a section's list that opens aimloom.dev's explorer on the same kind
 * (spec 2026-09-22 §7). The App builds the address in Rust; this only names the kind. Opening a
 * browser is best effort, so a failure changes nothing on the page.
 */
export function ExploreLink({ kind }: { kind: ExploreKind }) {
  const t = useT()
  const { lang } = useLang()
  const { openExplore } = useContext(SettingsState)
  return <p className="ws-explore-link">
    <button type="button" onClick={() => { openExplore(lang, kind).catch(() => {}) }}>{t(`explore.link.${kind}`)}<span aria-hidden="true"> ↗</span></button>
  </p>
}
