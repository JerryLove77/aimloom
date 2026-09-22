// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTrainingProfile, serializeTrainingProfile } from '../../../src/profiles/model'

/**
 * A Profile is validated in three places: here, in Rust (`profiles.rs`) and in the engine
 * (`Assert-KvkProfile`). One branch removed `crosshair` from what TypeScript writes and left the
 * other two requiring it — so every save on Windows would have failed, while 1314 tests passed,
 * because Rust's tests hand-wrote a Profile *with* the key and the PowerShell fixtures did too.
 * A later branch (2026-09-21) removed `enemy` the same way: a Profile no longer manages the enemy.
 *
 * `profile.saved.fixture.json` is the cure: it must be byte-for-byte what `serializeTrainingProfile`
 * really produces (this test), Rust must accept exactly that file (`profiles.rs`), and so must the
 * engine (`profiles.test.ps1`). Change what a Profile looks like in one layer and the fixture, or
 * one of the other two, goes red.
 *
 * `profile.legacy.fixture.json` is the other half: a Profile written before 2026-09-21 still
 * carries both `crosshair` and `enemy`, and must still open in every layer -- with both legacy
 * keys silently dropped, never validated and never written back.
 */
const path = fileURLToPath(new URL('./profile.saved.fixture.json', import.meta.url))
const fixture = readFileSync(path, 'utf8').trimEnd()
const legacyPath = fileURLToPath(new URL('./profile.legacy.fixture.json', import.meta.url))
const legacyFixture = readFileSync(legacyPath, 'utf8').trimEnd()

describe('what TypeScript saves is what the fixture holds', () => {
  it('the fixture is the serialiser\'s real output, not a hand-written lookalike', () => {
    expect(serializeTrainingProfile(parseTrainingProfile(JSON.parse(fixture)))).toBe(fixture)
  })

  it('the fixture exercises every component a Profile can record', () => {
    const saved = JSON.parse(fixture) as Record<string, unknown>
    expect(Object.keys(saved)).toEqual(['schemaVersion', 'id', 'name', 'scheme', 'audio'])
    expect(saved.scheme).not.toBeNull()
    expect(saved.audio).not.toBeNull()
  })

  it('a legacy file carrying both crosshair and enemy still opens, with both dropped', () => {
    const legacy = JSON.parse(legacyFixture) as Record<string, unknown>
    expect(legacy.crosshair).not.toBeNull()
    expect(legacy.enemy).not.toBeNull()
    const parsed = parseTrainingProfile(legacy)
    expect(parsed).not.toHaveProperty('crosshair')
    expect(parsed).not.toHaveProperty('enemy')
    // Re-serializing a legacy Profile writes today's shape, not the one it was read from.
    expect(serializeTrainingProfile(parseTrainingProfile(legacy))).not.toContain('crosshair')
    expect(serializeTrainingProfile(parseTrainingProfile(legacy))).not.toContain('"enemy"')
  })
})
