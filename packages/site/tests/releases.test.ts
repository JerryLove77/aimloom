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
  it('accepts a Setup hosted in the public R2 bucket under releases/, for files too big for a static asset', () => {
    const hosted = { ...setupFile, url: 'https://dl.aimloom.dev/releases/Aimloom-Setup-v0.1.0.exe' }
    expect(parseReleases(wrap({ ...stable, setup: hosted })).releases[0]?.setup).toEqual(hosted)
  })
  it('rejects a Setup that is not an .exe under /files/ or R2 releases/, or lacks a size or a SHA-256', () => {
    for (const bad of [{ ...setupFile, url: 'https://dl.example/x.exe' }, { ...setupFile, url: '/files/x.zip' },
                       { ...setupFile, url: 'https://dl.aimloom.dev/files/x.exe' }, { ...setupFile, url: 'https://dl.aimloom.dev/releases/x.zip' },
                       { ...setupFile, url: 'http://dl.aimloom.dev/releases/x.exe' }, { ...setupFile, url: 'https://dl.aimloom.dev.example/releases/x.exe' },
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
  it('recommends 0.1.7, stable, with the Setup on the site\'s R2 bucket and the portable ZIP on GitHub', () => {
    // Both files were built once from 502ab05 with the path-remapping build. The Setup is not
    // byte-reproducible, so these facts name the one file that exists. Change them only together.
    expect(releases.beta).toBeNull()
    const r = recommendedRelease(releases)
    expect(r).toMatchObject({
      version: '0.1.7', status: 'stable', bytes: 4_715_112, mirrorUrl: null,
      primaryUrl: 'https://github.com/JerryLove77/aimloom/releases/download/v0.1.7/Aimloom-v0.1.7.zip',
      sha256: 'd42245308d0d0b0f2d11b8b8b22179c2afae67d56d29c116de675d5e85e329dc',
      setup: {
        url: 'https://dl.aimloom.dev/releases/Aimloom-Setup-v0.1.7.exe', bytes: 3_385_044,
        sha256: 'cbb2461993e607fa550e8f768bc1b603b4deaa3ca537d9c988f5729086a82ada',
      },
    })
    expect(r?.contents).toEqual(['Aimloom.exe', '使用说明.txt', 'README.txt', 'VERSION.txt'])
    expect(r?.requires).toEqual(['WebView2'])
    // A player who skips the notes still has to learn that 0.1.5 goes first and its Profiles are not read.
    expect(r?.knownIssues.zh.join('')).toMatch(/卸载旧版本[\s\S]*重新创建/)
    expect(r?.knownIssues.en.join(' ')).toMatch(/uninstall the older Aimloom[\s\S]*create them again/)
    expect(r?.knownIssues.zh.length).toBe(r?.knownIssues.en.length)
  })
  it('keeps 0.1.6 as a stable record: the first release with the Rust engine', () => {
    // Both files were built once from 03be57d (main after PR #31).
    expect(releases.releases.find(x => x.version === '0.1.6')).toMatchObject({
      version: '0.1.6', status: 'stable', bytes: 4_718_595, mirrorUrl: null,
      primaryUrl: 'https://github.com/JerryLove77/aimloom/releases/download/v0.1.6/Aimloom-v0.1.6.zip',
      sha256: '768b506017a8e9d272b6a1afe89f1052309dcc31e7613f1fb7425fb12b688ba7',
      setup: {
        url: 'https://dl.aimloom.dev/releases/Aimloom-Setup-v0.1.6.exe', bytes: 3_388_455,
        sha256: 'cc08d2579103632140d49b2b53d17b45e49562a3226e954edc1c6521a4595cf7',
      },
    })
  })
  it('keeps 0.1.5 as a stable record: the last release with PowerShell 7 inside', () => {
    // Both files were built once from fe2a80e with the path-remapping build; the Setup was then
    // installed in a clean Windows Sandbox on the tester's PC.
    const r = releases.releases.find(x => x.version === '0.1.5')
    expect(r).toMatchObject({
      version: '0.1.5', status: 'stable', bytes: 114_017_809, mirrorUrl: null,
      primaryUrl: 'https://github.com/JerryLove77/aimloom/releases/download/v0.1.5/Aimloom-v0.1.5.zip',
      sha256: 'cb34187ef962fb56d0a383acbf58fce7baa32728e38debfba13c329dd1e8d5b8',
      setup: {
        url: 'https://dl.aimloom.dev/releases/Aimloom-Setup-v0.1.5.exe', bytes: 80_782_712,
        sha256: 'dc7fcab8cddbca172c9a5c6d3969b85bc49c5fcc236703b8e9e8ab95efca0901',
      },
    })
    expect(r?.contents).toContain('README.txt')
    expect(r?.contents).toContain('Aimloom.exe')
    expect(r?.contents).toContain('pwsh\\')
    // PowerShell 7 ships inside (pwsh\), so WebView2 is the only requirement left.
    expect(r?.requires).toEqual(['WebView2'])
    expect(r?.knownIssues.zh.length).toBe(r?.knownIssues.en.length)
    expect(r?.knownIssues.zh.length).toBeGreaterThan(0)
  })
  it('keeps 0.1.6-beta.2 as a record of the second beta: the Setup on R2 and the ZIP on GitHub', () => {
    // Built once from 36e06f1 (main after PR #27).
    const r = releases.releases.find(x => x.version === '0.1.6-beta.2')
    expect(r).toMatchObject({
      status: 'beta', bytes: 4_703_591, mirrorUrl: null,
      primaryUrl: 'https://github.com/JerryLove77/aimloom/releases/download/v0.1.6-beta.2/Aimloom-v0.1.6-beta.2.zip',
      sha256: 'a4581b3e6479a583ea2a0411913f88a2f37d8da1d653ac1f8bbb23e5496f11a6',
      setup: {
        url: 'https://dl.aimloom.dev/releases/Aimloom-Setup-v0.1.6-beta.2.exe', bytes: 3_378_366,
        sha256: 'ae57706f9b51e9275db91fa083745d9350aec133825e7683463d95fb188740cd',
      },
    })
    expect(r?.contents).toEqual(['Aimloom.exe', '使用说明.txt', 'README.txt', 'VERSION.txt'])
    expect(r?.requires).toEqual(['WebView2'])
    // A player who skips the notes still has to learn that 0.1.5 Profiles are not read.
    expect(r?.knownIssues.zh.join('')).toContain('重新创建')
    expect(r?.knownIssues.en.join(' ')).toMatch(/created again/)
    expect(r?.knownIssues.zh.length).toBe(r?.knownIssues.en.length)
  })
  it('keeps 0.1.6-beta.1 as a record of the first Rust-only beta', () => {
    const r = releases.releases.find(x => x.version === '0.1.6-beta.1')
    expect(r).toMatchObject({ bytes: 4_652_876, sha256: '44fb9ed03fb04a64c5bd219408f9816833b1f65d807819e5bc736ce4b3194e66' })
    expect(r?.setup?.sha256).toBe('0d7a0c4dfc9b7fc963fe8cf1b17c0353ffcfdd267d7c201a3fa3b8e6f82d3658')
  })
  it('keeps 0.1.4 as a stable record, served by the site itself', () => {
    const r = releases.releases.find(x => x.version === '0.1.4')
    expect(r).toMatchObject({
      status: 'stable', bytes: 4_390_696, primaryUrl: '/files/Aimloom-v0.1.4.zip',
      sha256: '8020db50161b59de4dee51c9f754bc7b7840298c68f4580f31b0c167e8165c14',
      setup: { url: '/files/Aimloom-Setup-v0.1.4.exe', bytes: 3_172_457, sha256: 'aef57e8284b3a68ebb0eb09bbcba10122c3b920e4c9c79bc3758e34369a0095a' },
    })
  })
  it('lists no release that was never published', () => {
    expect(releases.releases.map(r => r.version)).not.toContain('0.1.0')
  })
  it('offers no beta after stable 0.1.6', () => {
    expect(betaRelease(releases)).toBeNull()
  })
})
