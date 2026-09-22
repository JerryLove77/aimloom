import { describe, expect, it, vi } from 'vitest'

// A fixture ReleaseData with a stable recommendation and a newer beta, so GET() can be exercised
// end to end without depending on whether the committed releases.json currently has a beta.
// vi.mock's factory is hoisted above these, so the fixtures are built inside vi.hoisted.
const { stableRelease, betaRelease, olderBetaRelease } = vi.hoisted(() => {
  const fact = {
    date: '2026-10-01', platform: 'Windows 10/11 x64', requires: ['PowerShell 7.0+'], bytes: 1_000_000,
    sha256: 'a'.repeat(64), primaryUrl: 'https://dl.example/x.zip', mirrorUrl: null, contents: [],
    notes: { zh: '', en: '' }, knownIssues: { zh: [], en: [] }, setup: null,
  }
  return {
    stableRelease: { version: '0.1.4', status: 'stable' as const, ...fact },
    betaRelease: { version: '0.1.5-beta.1', status: 'beta' as const, ...fact },
    olderBetaRelease: { version: '0.1.4-beta.1', status: 'beta' as const, ...fact },
  }
})

vi.mock('../src/data/releases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/releases')>()
  return {
    ...actual,
    releases: {
      schemaVersion: 1 as const, recommended: '0.1.4', beta: '0.1.5-beta.1',
      releases: [stableRelease, betaRelease, olderBetaRelease],
    },
  }
})

import { GET } from '../src/pages/latest.json'

describe('GET /latest.json, unit (a stubbed stable + newer beta)', () => {
  it('answers both fields when the beta is newer than the stable recommendation', async () => {
    expect(await GET().json()).toEqual({ version: '0.1.4', beta: '0.1.5-beta.1' })
  })
})
