import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs script run by node at deploy time; it has no type declarations
import { stageRelease } from '../scripts/stage-release.mjs'

const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from(' a stand-in for the release ZIP')])
const sha = createHash('sha256').update(zip).digest('hex')
function setup(release: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aimloom-stage-'))
  const dist = join(root, 'dist'), source = join(root, 'release-files'), releasesPath = join(root, 'releases.json')
  mkdirSync(dist); mkdirSync(source)
  writeFileSync(releasesPath, JSON.stringify({ schemaVersion: 1, recommended: '0.1.1', releases: [{
    version: '0.1.1', status: 'beta', bytes: zip.length, sha256: sha, primaryUrl: '/files/Aimloom-v0.1.1.zip', mirrorUrl: null, ...release,
  }] }))
  return { dist, source, releasesPath, staged: join(dist, 'files', 'Aimloom-v0.1.1.zip') }
}
const run = (s: ReturnType<typeof setup>) => stageRelease({ dist: s.dist, source: s.source, releasesPath: s.releasesPath })

describe('stageRelease', () => {
  it('copies the ZIP the release data describes into dist/files', () => {
    const s = setup()
    writeFileSync(join(s.source, 'Aimloom-v0.1.1.zip'), zip)
    expect(run(s)).toEqual([{ file: 'Aimloom-v0.1.1.zip', bytes: zip.length }])
    expect(readFileSync(s.staged).equals(zip)).toBe(true)
  })
  it('refuses when the ZIP is missing, naming where it looked', () => {
    const s = setup()
    expect(() => run(s)).toThrow(/release-files.*Aimloom-v0\.1\.1\.zip/)
  })
  it('refuses a ZIP whose bytes differ from the release data, and stages nothing', () => {
    const s = setup()
    const sameSize = Buffer.from(zip); sameSize[sameSize.length - 1] = 0x21
    writeFileSync(join(s.source, 'Aimloom-v0.1.1.zip'), sameSize)
    expect(() => run(s)).toThrow(/SHA-256/)
    writeFileSync(join(s.source, 'Aimloom-v0.1.1.zip'), Buffer.concat([zip, Buffer.from('x')]))
    expect(() => run(s)).toThrow(/bytes/)
    expect(existsSync(s.staged)).toBe(false)
  })
  it('leaves releases hosted elsewhere, and unreleased ones, alone', () => {
    for (const release of [{ primaryUrl: 'https://dl.example/x.zip' }, { status: 'preparing', primaryUrl: null, bytes: null, sha256: null }]) {
      expect(run(setup(release))).toEqual([])
    }
  })
  it('refuses to run before the site is built', () => {
    const s = setup()
    expect(() => stageRelease({ dist: join(s.dist, 'missing'), source: s.source, releasesPath: s.releasesPath })).toThrow(/astro build/)
  })

  const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.from(' a stand-in for the Setup')])
  const exeSha = createHash('sha256').update(exe).digest('hex')
  const withSetup = { setup: { url: '/files/Aimloom-Setup-v0.1.1.exe', bytes: exe.length, sha256: exeSha } }

  it('stages the Setup beside the ZIP, each checked against its own size and SHA-256', () => {
    const s = setup(withSetup)
    writeFileSync(join(s.source, 'Aimloom-v0.1.1.zip'), zip)
    writeFileSync(join(s.source, 'Aimloom-Setup-v0.1.1.exe'), exe)
    expect(run(s)).toEqual([{ file: 'Aimloom-v0.1.1.zip', bytes: zip.length }, { file: 'Aimloom-Setup-v0.1.1.exe', bytes: exe.length }])
    expect(readFileSync(join(s.dist, 'files', 'Aimloom-Setup-v0.1.1.exe')).equals(exe)).toBe(true)
  })
  it('refuses a Setup whose bytes differ, naming the .exe', () => {
    const s = setup(withSetup)
    writeFileSync(join(s.source, 'Aimloom-v0.1.1.zip'), zip)
    const wrong = Buffer.from(exe); wrong[wrong.length - 1] = 0x21
    writeFileSync(join(s.source, 'Aimloom-Setup-v0.1.1.exe'), wrong)
    expect(() => run(s)).toThrow(/Aimloom-Setup-v0\.1\.1\.exe.*SHA-256/)
    expect(existsSync(join(s.dist, 'files', 'Aimloom-Setup-v0.1.1.exe'))).toBe(false)
  })
  it('refuses when the Setup is missing from release-files', () => {
    const s = setup(withSetup)
    writeFileSync(join(s.source, 'Aimloom-v0.1.1.zip'), zip)
    expect(() => run(s)).toThrow(/release-files.*Aimloom-Setup-v0\.1\.1\.exe/)
  })
})
