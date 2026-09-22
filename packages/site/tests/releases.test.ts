import { describe, expect, it } from 'vitest'
import { formatBytes, parseReleases, recommendedRelease, releases } from '../src/data/releases'

const preparing = {
  version: '0.1.0', status: 'preparing', date: null, platform: 'Windows 10/11 x64',
  requires: ['PowerShell 7.0+'], bytes: null, sha256: null, primaryUrl: null, mirrorUrl: null,
  contents: ['安装配置.cmd'], notes: { zh: '准备中', en: 'Preparing' }, knownIssues: { zh: [], en: [] },
}
const stable = {
  ...preparing, status: 'stable', date: '2026-10-01', bytes: 12_345_678,
  sha256: 'a'.repeat(64), primaryUrl: 'https://dl.example/v0.1.0.zip', mirrorUrl: 'https://github.com/x/releases/v0.1.0.zip',
}
const wrap = (r: unknown, recommended: string | null = '0.1.0') => ({ schemaVersion: 1, recommended, releases: [r] })

describe('parseReleases', () => {
  it('accepts a preparing release with every download fact null', () => {
    expect(parseReleases(wrap(preparing)).releases[0]?.status).toBe('preparing')
  })
  it('rejects a preparing release that carries a URL', () => {
    expect(() => parseReleases(wrap({ ...preparing, primaryUrl: 'https://x/y.zip' }))).toThrow(/preparing/)
  })
  it('rejects a stable release missing the sha256', () => {
    expect(() => parseReleases(wrap({ ...stable, sha256: null }))).toThrow(/sha256/)
  })
  it('rejects a sha256 that is not 64 hex chars', () => {
    expect(() => parseReleases(wrap({ ...stable, sha256: 'xyz' }))).toThrow(/sha256/)
  })
  it('rejects a beta release without a date', () => {
    expect(() => parseReleases(wrap({ ...stable, status: 'beta', date: null }))).toThrow(/date/)
  })
  it('rejects a recommended version that no entry has', () => {
    expect(() => parseReleases(wrap(stable, '9.9.9'))).toThrow(/recommended/)
  })
  it('rejects duplicate versions', () => {
    expect(() => parseReleases({ schemaVersion: 1, recommended: null, releases: [stable, stable] })).toThrow(/duplicate/)
  })
  it('rejects unknown top-level keys', () => {
    expect(() => parseReleases({ ...wrap(stable), extra: 1 })).toThrow(/unknown/)
  })
  it('accepts a beta without a mirror while the repository is private', () => {
    expect(parseReleases(wrap({ ...stable, status: 'beta', mirrorUrl: null })).releases[0]?.mirrorUrl).toBeNull()
  })
  it('accepts a ZIP served from the site itself under /files/', () => {
    expect(parseReleases(wrap({ ...stable, primaryUrl: '/files/Aimloom-v0.1.0.zip' })).releases[0]?.primaryUrl).toBe('/files/Aimloom-v0.1.0.zip')
  })
  it('rejects any other relative or non-https download URL', () => {
    for (const url of ['/downloads/x.zip', 'files/x.zip', '/files/../x.zip', '/files/x.exe', 'http://dl.example/x.zip']) {
      expect(() => parseReleases(wrap({ ...stable, primaryUrl: url })), url).toThrow(/primaryUrl/)
    }
    expect(() => parseReleases(wrap({ ...stable, mirrorUrl: '/files/x.zip' }))).toThrow(/mirrorUrl/)
  })
  it('rejects a wrong schemaVersion', () => {
    expect(() => parseReleases({ ...wrap(stable), schemaVersion: 2 })).toThrow(/schemaVersion/)
  })

  const setupFile = { url: '/files/Aimloom-Setup-v0.1.0.exe', bytes: 4_500_000, sha256: 'b'.repeat(64) }
  it('accepts a Setup served from the site under /files/, with its own size and SHA-256', () => {
    expect(parseReleases(wrap({ ...stable, setup: setupFile })).releases[0]?.setup).toEqual(setupFile)
  })
  it('reads a release without a Setup as setup: null', () => {
    expect(parseReleases(wrap(stable)).releases[0]?.setup).toBeNull()
  })
  it('rejects a Setup that is not an .exe under /files/, or lacks a size or a SHA-256', () => {
    for (const bad of [{ ...setupFile, url: 'https://dl.example/x.exe' }, { ...setupFile, url: '/files/x.zip' },
                       { ...setupFile, bytes: 0 }, { ...setupFile, sha256: 'nope' }, { ...setupFile, extra: 1 }]) {
      expect(() => parseReleases(wrap({ ...stable, setup: bad })), JSON.stringify(bad)).toThrow(/setup/)
    }
  })
  it('rejects a Setup on a release still in preparation', () => {
    expect(() => parseReleases(wrap({ ...preparing, setup: setupFile }))).toThrow(/setup/)
  })
})

describe('recommendedRelease', () => {
  it('returns the entry named by recommended', () => {
    expect(recommendedRelease(parseReleases(wrap(stable)))?.version).toBe('0.1.0')
  })
  it('returns null when recommended is null', () => {
    expect(recommendedRelease(parseReleases(wrap(stable, null)))).toBeNull()
  })
})

describe('formatBytes', () => {
  it('formats MB with one decimal', () => expect(formatBytes(12_345_678)).toBe('11.8 MB'))
  it('formats KB below a megabyte', () => expect(formatBytes(980 * 1024)).toBe('980 KB'))
})

describe('the committed releases.json', () => {
  it('parses', () => {
    expect(releases.schemaVersion).toBe(1)
  })
  it('still lists 0.1.1, whose ZIP the site keeps serving', () => {
    // docs/superpowers/notes/2026-09-19-windows-soft-launch-test.md. Change these facts only together.
    expect(releases.releases.find(x => x.version === '0.1.1')).toMatchObject({
      status: 'beta', bytes: 3_281_812, mirrorUrl: null, primaryUrl: '/files/Aimloom-v0.1.1.zip', setup: null,
      sha256: '35b69259d026868ccfb358b719eb256b2b45ab703ed287e661c8883d4a875158',
    })
  })
  it('recommends 0.1.2, a beta with a Setup and a portable ZIP, both served by the site itself', () => {
    // Both files (rc.2) were built once on the tester's PC from 3ff5be8 and checked there
    // (docs/superpowers/notes/2026-09-20-setup-windows-verification.md). The Setup is not
    // byte-reproducible, so these facts name the one file that exists. Change them only together.
    const r = recommendedRelease(releases)
    expect(r).toMatchObject({
      version: '0.1.2', status: 'beta', bytes: 3_329_758, mirrorUrl: null, primaryUrl: '/files/Aimloom-v0.1.2.zip',
      sha256: 'c6d5b60aea25c5b0f8f91e401a4d31cb5711626a995d5fb8ace228f292e31371',
      setup: {
        url: '/files/Aimloom-Setup-v0.1.2.exe', bytes: 2_365_929,
        sha256: '7eb0cddb76ff5957a940cf39eada79836d234096ba1950e95c5e5f4c9f9a0da9',
      },
    })
    expect(r?.contents).toContain('README.txt')
    expect(r?.contents).toContain('Aimloom.exe')
    expect(r?.requires).toEqual(['PowerShell 7.0+', 'WebView2'])
    expect(r?.knownIssues.zh.length).toBe(r?.knownIssues.en.length)
    expect(r?.knownIssues.zh.length).toBeGreaterThan(0)
  })
  it('lists no release that was never published', () => {
    expect(releases.releases.map(r => r.version)).not.toContain('0.1.0')
  })
})
