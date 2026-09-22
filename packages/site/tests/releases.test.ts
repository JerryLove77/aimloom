import { describe, expect, it } from 'vitest'
import { betaRelease, formatBytes, parseReleases, recommendedRelease, releases } from '../src/data/releases'

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
    expect(parseReleases(wrap(preparing, null)).releases[0]?.status).toBe('preparing')
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
  it('keeps a withdrawn release as a record, with its download facts', () => {
    expect(parseReleases(wrap({ ...stable, status: 'withdrawn' }, null)).releases[0]?.status).toBe('withdrawn')
    expect(() => parseReleases(wrap({ ...stable, status: 'withdrawn', sha256: null }, null))).toThrow(/sha256/)
  })
  it('refuses to recommend a withdrawn release', () => {
    expect(() => parseReleases(wrap({ ...stable, status: 'withdrawn' }))).toThrow(/withdrawn/)
  })
  it('refuses to recommend a release that is not stable', () => {
    expect(() => parseReleases(wrap({ ...stable, status: 'beta' }))).toThrow(/recommended.*stable/)
  })
  it('rejects duplicate versions', () => {
    expect(() => parseReleases({ schemaVersion: 1, recommended: null, releases: [stable, stable] })).toThrow(/duplicate/)
  })
  it('rejects unknown top-level keys', () => {
    expect(() => parseReleases({ ...wrap(stable), extra: 1 })).toThrow(/unknown/)
  })
  it('accepts a beta without a mirror while the repository is private', () => {
    expect(parseReleases(wrap({ ...stable, status: 'beta', mirrorUrl: null }, null)).releases[0]?.mirrorUrl).toBeNull()
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

  it('treats an absent beta key, and an explicit beta: null, the same way', () => {
    expect(parseReleases(wrap(stable)).beta).toBeNull()
    expect(parseReleases({ schemaVersion: 1, recommended: '0.1.0', beta: null, releases: [stable] }).beta).toBeNull()
  })
  it('accepts a beta field naming a beta release newer than a stable recommended', () => {
    const beta = { ...stable, version: '0.1.1', status: 'beta' }
    const data = parseReleases({ schemaVersion: 1, recommended: '0.1.0', beta: '0.1.1', releases: [stable, beta] })
    expect(data.beta).toBe('0.1.1')
  })
  it('rejects a beta field naming a release that is not itself beta', () => {
    const notBeta = { ...stable, version: '0.1.1', status: 'stable' }
    expect(() => parseReleases({ schemaVersion: 1, recommended: '0.1.0', beta: '0.1.1', releases: [stable, notBeta] })).toThrow(/beta 0\.1\.1 must name a beta release/)
  })
  it('rejects a beta field naming no release', () => {
    expect(() => parseReleases({ schemaVersion: 1, recommended: '0.1.0', beta: '9.9.9', releases: [stable] })).toThrow(/beta 9\.9\.9 names no release/)
  })
  it('rejects a beta that is not newer than recommended', () => {
    const beta = { ...stable, version: '0.1.0-beta.1', status: 'beta' }
    expect(() => parseReleases({ schemaVersion: 1, recommended: '0.1.0', beta: '0.1.0-beta.1', releases: [stable, beta] })).toThrow(/beta 0\.1\.0-beta\.1 must be newer than recommended 0\.1\.0/)
  })
  it('accepts a beta field with no recommended to compare against', () => {
    const beta = { ...stable, version: '0.1.1', status: 'beta' }
    expect(parseReleases({ schemaVersion: 1, recommended: null, beta: '0.1.1', releases: [beta] }).beta).toBe('0.1.1')
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

describe('betaRelease', () => {
  it('returns the entry named by beta', () => {
    const beta = { ...stable, version: '0.1.1', status: 'beta' }
    const data = parseReleases({ schemaVersion: 1, recommended: '0.1.0', beta: '0.1.1', releases: [stable, beta] })
    expect(betaRelease(data)?.version).toBe('0.1.1')
  })
  it('returns null when beta is null', () => {
    expect(betaRelease(parseReleases(wrap(stable)))).toBeNull()
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
  it('keeps 0.1.1 and 0.1.2 as withdrawn records: their Aimloom.exe carries the builder\'s Windows user name', () => {
    for (const version of ['0.1.1', '0.1.2']) {
      expect(releases.releases.find(x => x.version === version)?.status, version).toBe('withdrawn')
    }
  })
  it('recommends 0.1.4, stable, with a Setup and a portable ZIP, both served by the site itself', () => {
    // Both files were built once from 54668f4 with the path-remapping build; 0.1.4-beta.2 from
    // 856fb40 was the build accepted on the tester's PC. The Setup is not byte-reproducible, so
    // these facts name the one file that exists. Change them only together.
    const r = recommendedRelease(releases)
    expect(r).toMatchObject({
      version: '0.1.4', status: 'stable', bytes: 4_390_696, mirrorUrl: null, primaryUrl: '/files/Aimloom-v0.1.4.zip',
      sha256: '8020db50161b59de4dee51c9f754bc7b7840298c68f4580f31b0c167e8165c14',
      setup: {
        url: '/files/Aimloom-Setup-v0.1.4.exe', bytes: 3_172_457,
        sha256: 'aef57e8284b3a68ebb0eb09bbcba10122c3b920e4c9c79bc3758e34369a0095a',
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
  it('carries no beta yet', () => {
    expect(releases.beta).toBeNull()
    expect(betaRelease(releases)).toBeNull()
  })
})
