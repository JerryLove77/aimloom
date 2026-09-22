import { describe, expect, it } from 'vitest'
import { changelogEntries } from '../src/lib/changelog-view'
import type { Release, ReleaseData } from '../src/data/releases'

const r = (version: string, status: Release['status'], date: string | null): Release => ({
  version, status, date, platform: 'Windows', requires: [], bytes: status === 'preparing' ? null : 1,
  sha256: status === 'preparing' ? null : '0'.repeat(64), primaryUrl: status === 'preparing' ? null : 'https://a',
  mirrorUrl: status === 'preparing' ? null : 'https://b', contents: [], notes: { zh: `说明 ${version}`, en: `Notes ${version}` },
  knownIssues: { zh: [], en: ['known'] }, setup: null,
})
const data: ReleaseData = { schemaVersion: 1, recommended: null, beta: null, releases: [r('0.1.0', 'stable', '2026-10-01'), r('0.1.10', 'preparing', null), r('0.1.2', 'beta', '2026-11-01')] }

describe('changelogEntries', () => {
  it('orders newest first by semver, not by string', () => {
    expect(changelogEntries(data, 'en').map(e => e.version)).toEqual(['0.1.10', '0.1.2', '0.1.0'])
  })
  it('orders a release above its own betas, and betas by number', () => {
    const withBetas: ReleaseData = { ...data, releases: [r('0.1.4-beta.1', 'beta', '2026-10-02'), r('0.1.4', 'stable', '2026-10-09'), r('0.1.4-beta.2', 'beta', '2026-10-05'), r('0.1.3', 'stable', '2026-09-22')] }
    expect(changelogEntries(withBetas, 'en').map(e => e.version)).toEqual(['0.1.4', '0.1.4-beta.2', '0.1.4-beta.1', '0.1.3'])
  })
  it('flags unreleased entries and localizes notes', () => {
    const [top] = changelogEntries(data, 'zh')
    expect(top).toMatchObject({ version: '0.1.10', released: false, date: null, notes: '说明 0.1.10' })
  })
})
