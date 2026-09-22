import { describe, expect, it, vi } from 'vitest'

// A fixture where the beta field still names an entry, but that entry is no longer newer than the
// stable recommendation (the stable release caught up, or passed it). GET() must hide it: a
// finished beta disappears on its own, without needing releases.json to clear the field by hand.
// vi.mock's factory is hoisted above these, so the fixtures are built inside vi.hoisted.
const { stableRelease, finishedBetaRelease } = vi.hoisted(() => {
  const fact = {
    date: '2026-10-01', platform: 'Windows 10/11 x64', requires: ['PowerShell 7.0+'], bytes: 1_000_000,
    sha256: 'a'.repeat(64), primaryUrl: 'https://dl.example/x.zip', mirrorUrl: null, contents: [],
    notes: { zh: '', en: '' }, knownIssues: { zh: [], en: [] }, setup: null,
  }
  return {
    stableRelease: { version: '0.1.5', status: 'stable' as const, ...fact },
    finishedBetaRelease: { version: '0.1.5-beta.1', status: 'beta' as const, ...fact },
  }
})

vi.mock('../src/data/releases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/releases')>()
  return {
    ...actual,
    releases: {
      schemaVersion: 1 as const, recommended: '0.1.5', beta: '0.1.5-beta.1',
      releases: [stableRelease, finishedBetaRelease],
    },
  }
})

import { GET } from '../src/pages/latest.json'

describe('GET /latest.json, unit (a beta field naming a release no longer newer than stable)', () => {
  it('answers beta: null, hiding a finished beta', async () => {
    expect(await GET().json()).toEqual({ version: '0.1.5', beta: null })
  })
})
