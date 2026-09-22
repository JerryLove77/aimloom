import { describe, expect, it, vi } from 'vitest'

// The real releases.json currently recommends a `beta` release, so the build test (tests/build.test.ts)
// can never exercise the `preparing` branch of GET(). This stubs the release data to reach it directly.
vi.mock('../src/data/releases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/releases')>()
  const preparing = {
    version: '9.9.9', status: 'preparing' as const, date: null, platform: 'Windows 10/11 x64', requires: [],
    bytes: null, sha256: null, primaryUrl: null, mirrorUrl: null, contents: [],
    notes: { zh: '', en: '' }, knownIssues: { zh: [], en: [] }, setup: null,
  }
  return { ...actual, releases: { schemaVersion: 1 as const, recommended: '9.9.9', releases: [preparing] } }
})

import { GET } from '../src/pages/latest.json'

describe('GET /latest.json, unit (a stubbed "preparing" recommendation)', () => {
  it('answers {"version": null}: no download exists yet, and the App must not be told to fetch one', async () => {
    expect(await GET().json()).toEqual({ version: null })
  })
})
