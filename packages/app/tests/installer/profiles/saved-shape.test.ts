// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTrainingProfile, serializeTrainingProfile } from '../../../src/profiles/model'

/**
 * A Profile is validated in four places: here, in the App's Rust (`installer/profiles.rs`), and in
 * both engines (`Assert-KvkProfile`, `engine/profiles.rs`). One branch once removed a key from what
 * TypeScript writes and left the other layers requiring it -- every save on Windows would have
 * failed while every test passed, because each layer's tests hand-wrote their own Profile.
 *
 * `profile.saved.fixture.json` is the cure: it must be byte-for-byte what `serializeTrainingProfile`
 * really produces (this test), and Rust and both engines must accept exactly that file. Since
 * 2026-09-30 it is a v2 complete snapshot: the theme and all six sound events.
 *
 * `profile.legacy.fixture.json` is a version 1 Profile (keep-current gaps, `scheme`, and the old
 * `crosshair` and `enemy` records). The user chose no data migration, so every layer refuses it.
 */
const path = fileURLToPath(new URL('./profile.saved.fixture.json', import.meta.url))
const fixture = readFileSync(path, 'utf8').trimEnd()
const legacyPath = fileURLToPath(new URL('./profile.legacy.fixture.json', import.meta.url))
const legacyFixture = readFileSync(legacyPath, 'utf8').trimEnd()

describe('what TypeScript saves is what the fixture holds', () => {
  it('the fixture is the serialiser\'s real output, not a hand-written lookalike', () => {
    expect(serializeTrainingProfile(parseTrainingProfile(JSON.parse(fixture)))).toBe(fixture)
  })

  it('the fixture is a complete snapshot: the theme and all six events, one silent', () => {
    const saved = JSON.parse(fixture) as { theme: unknown; audio: Record<string, unknown[]> }
    expect(Object.keys(saved)).toEqual(['schemaVersion', 'id', 'name', 'theme', 'audio'])
    expect(saved.theme).not.toBeNull()
    expect(Object.keys(saved.audio)).toEqual(['kill', 'spawn', 'mbsGood', 'mbsOkay', 'mbsBad', 'mbsChangeNow'])
    expect(saved.audio.spawn).toEqual([])
  })

  it('a version 1 Profile is refused', () => {
    const legacy = JSON.parse(legacyFixture) as Record<string, unknown>
    expect(legacy.schemaVersion).toBe(1)
    expect(() => parseTrainingProfile(legacy)).toThrow()
  })
})
