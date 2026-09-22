import { isNewer, type ReleaseData, type ReleaseStatus } from '../data/releases'
import type { Lang } from '../i18n'

export interface ChangelogEntry { version: string; released: boolean; date: string | null; status: ReleaseStatus; notes: string; knownIssues: string[] }

// Semver precedence, prereleases included (0.1.4 > 0.1.4-beta.2 > 0.1.4-beta.1), shared with the
// parser and latest.json so the three can never order versions differently.
function compareSemverDesc(a: string, b: string): number {
  return isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0
}

export function changelogEntries(data: ReleaseData, lang: Lang): ChangelogEntry[] {
  return [...data.releases]
    .sort((a, b) => compareSemverDesc(a.version, b.version))
    .map(r => ({ version: r.version, released: r.status !== 'preparing', date: r.date, status: r.status, notes: r.notes[lang], knownIssues: r.knownIssues[lang] }))
}
