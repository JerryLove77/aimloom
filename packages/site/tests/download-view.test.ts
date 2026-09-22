import { describe, expect, it } from 'vitest'
import { downloadView, statusLabel } from '../src/lib/download-view'
import type { Release } from '../src/data/releases'

const base: Release = {
  version: '0.1.0', status: 'preparing', date: null, platform: 'Windows 10/11 x64', requires: ['PowerShell 7.0+'],
  bytes: null, sha256: null, primaryUrl: null, mirrorUrl: null, contents: ['安装配置.cmd'],
  notes: { zh: '说明', en: 'Notes' }, knownIssues: { zh: ['问题一'], en: ['Issue one'] }, setup: null,
}
const stable: Release = { ...base, status: 'stable', date: '2026-10-01', bytes: 12_345_678, sha256: 'f'.repeat(64), primaryUrl: 'https://dl/x.zip', mirrorUrl: 'https://github.com/x' }

describe('downloadView', () => {
  it('is none without a recommended release', () => expect(downloadView(null, 'zh')).toEqual({ kind: 'none' }))
  it('exposes no URL while preparing', () => {
    const v = downloadView(base, 'zh')
    expect(v.kind).toBe('preparing')
    expect(JSON.stringify(v)).not.toContain('http')
  })
  it('carries every fact for a stable release in the requested language', () => {
    const v = downloadView(stable, 'en')
    expect(v).toMatchObject({ kind: 'stable', version: '0.1.0', date: '2026-10-01', size: '11.8 MB', primaryUrl: 'https://dl/x.zip', knownIssues: ['Issue one'], notes: 'Notes' })
  })
  it('marks beta as beta', () => expect(downloadView({ ...stable, status: 'beta' }, 'zh').kind).toBe('beta'))
  it('carries a missing mirror as null rather than inventing one', () => {
    expect(downloadView({ ...stable, status: 'beta', mirrorUrl: null }, 'zh')).toMatchObject({ kind: 'beta', mirrorUrl: null })
  })
  it('carries the Setup with a formatted size when the release has one', () => {
    const v = downloadView({ ...stable, setup: { url: '/files/Aimloom-Setup-v0.1.0.exe', bytes: 4_718_592, sha256: 'e'.repeat(64) } }, 'zh')
    expect(v).toMatchObject({ setup: { url: '/files/Aimloom-Setup-v0.1.0.exe', size: '4.5 MB', sha256: 'e'.repeat(64) } })
  })
  it('carries no Setup for a release without one', () => {
    expect(downloadView({ ...stable, setup: null }, 'zh')).toMatchObject({ setup: null })
  })
  it('end to end: a release with a Setup produces a fully-populated view with no regression to the ZIP fields', () => {
    const withSetup = { ...stable, setup: { url: '/files/Aimloom-Setup-v0.1.0.exe', bytes: 4_718_592, sha256: 'e'.repeat(64) } }
    const v = downloadView(withSetup, 'en')
    expect(v).toEqual({
      kind: 'stable', version: '0.1.0', date: '2026-10-01', size: '11.8 MB', sha256: 'f'.repeat(64),
      platform: 'Windows 10/11 x64', requires: ['PowerShell 7.0+'], contents: ['安装配置.cmd'],
      primaryUrl: 'https://dl/x.zip', mirrorUrl: 'https://github.com/x',
      knownIssues: ['Issue one'], notes: 'Notes',
      setup: { url: '/files/Aimloom-Setup-v0.1.0.exe', size: '4.5 MB', sha256: 'e'.repeat(64) },
    })
  })
  it('end to end: a release without a Setup produces exactly the old view fields plus setup: null', () => {
    const v = downloadView(stable, 'en')
    expect(v).toEqual({
      kind: 'stable', version: '0.1.0', date: '2026-10-01', size: '11.8 MB', sha256: 'f'.repeat(64),
      platform: 'Windows 10/11 x64', requires: ['PowerShell 7.0+'], contents: ['安装配置.cmd'],
      primaryUrl: 'https://dl/x.zip', mirrorUrl: 'https://github.com/x',
      knownIssues: ['Issue one'], notes: 'Notes',
      setup: null,
    })
  })
})

describe('statusLabel', () => {
  it('localizes', () => {
    expect(statusLabel('preparing', 'zh')).toBe('准备中')
    expect(statusLabel('stable', 'en')).toBe('Stable')
  })
})
