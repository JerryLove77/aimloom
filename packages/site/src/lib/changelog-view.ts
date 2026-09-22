import type { ReleaseData, ReleaseStatus } from '../data/releases'
import type { Lang } from '../i18n'

export interface ChangelogEntry { version: string; released: boolean; date: string | null; status: ReleaseStatus; notes: string; knownIssues: string[] }

function semverParts(v: string): number[] { return v.split('.').map(p => Number.parseInt(p, 10) || 0) }
function compareSemverDesc(a: string, b: string): number {
  const x = semverParts(a), y = semverParts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function changelogEntries(data: ReleaseData, lang: Lang): ChangelogEntry[] {
  return [...data.releases]
    .sort((a, b) => compareSemverDesc(a.version, b.version))
    .map(r => ({ version: r.version, released: r.status !== 'preparing', date: r.date, status: r.status, notes: r.notes[lang], knownIssues: r.knownIssues[lang] }))
}
