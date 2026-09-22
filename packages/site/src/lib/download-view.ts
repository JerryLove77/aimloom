import { formatBytes, type Release, type ReleaseStatus } from '../data/releases'
import { t, type Lang } from '../i18n'

export type DownloadView =
  | { kind: 'none' }
  | { kind: 'preparing'; version: string; platform: string; requires: string[] }
  | {
      kind: 'beta' | 'stable'; version: string; date: string; size: string; sha256: string
      platform: string; requires: string[]; contents: string[]; primaryUrl: string; mirrorUrl: string | null
      knownIssues: string[]; notes: string; setup: { url: string; size: string; sha256: string } | null
    }

export function downloadView(release: Release | null, lang: Lang): DownloadView {
  if (release === null) return { kind: 'none' }
  if (release.status === 'preparing') {
    return { kind: 'preparing', version: release.version, platform: release.platform, requires: release.requires }
  }
  // parseReleases guarantees these are non-null for beta/stable; the checks keep the types honest.
  if (release.date === null || release.bytes === null || release.sha256 === null || release.primaryUrl === null) {
    throw new Error(`release ${release.version} is ${release.status} but lacks download facts`)
  }
  return {
    kind: release.status, version: release.version, date: release.date, size: formatBytes(release.bytes),
    sha256: release.sha256, platform: release.platform, requires: release.requires, contents: release.contents,
    primaryUrl: release.primaryUrl, mirrorUrl: release.mirrorUrl, knownIssues: release.knownIssues[lang], notes: release.notes[lang],
    setup: release.setup === null ? null : { url: release.setup.url, size: formatBytes(release.setup.bytes), sha256: release.setup.sha256 },
  }
}

export function statusLabel(kind: ReleaseStatus, lang: Lang): string {
  return t(lang, `download.status.${kind}`)
}
