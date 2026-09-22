// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('the report contract', () => {
  it('is the same document the deployed backend validates', () => {
    // packages/site/src/worker/report-schema.ts refuses any unknown key at any level, so a payload
    // the App invents differs from this file only by being refused in production.
    expect(read('packages/app/tests/installer/report/contract.fixture.json'))
      .toBe(read('packages/site/tests-worker/fixtures/report.valid.json'))
  })
  it('names every key the App must produce, and no other', () => {
    const report = JSON.parse(read('packages/app/tests/installer/report/contract.fixture.json'))
    expect(Object.keys(report).sort()).toEqual(['account', 'app', 'contact', 'description', 'game', 'log', 'system'])
    expect(Object.keys(report.app).sort()).toEqual(['built', 'commit', 'label'])
    expect(Object.keys(report.system).sort()).toEqual(['displayLanguage', 'lang', 'langChoice', 'powershell', 'windows'])
    expect(Object.keys(report.game)).toEqual(['found'])
    expect(Object.keys(report.account).sort()).toEqual(['name', 'steamId', 'verified'])
    expect(report.account.verified).toBe(false)
  })
})
