// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { en } from '../../../src/i18n/en'
import { zh } from '../../../src/i18n/zh'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const read = (path: string) => readFileSync(root + path, 'utf8')

/**
 * The privacy sentences are promises about report.rs. `scrub` replaces the Windows user name and
 * the PC name and deliberately keeps folder paths; what the player types is not scrubbed at all.
 * A sentence that promised more than that reached the live site once (2026-09-21).
 */
describe('what the privacy copy promises about a report', () => {
  const rust = read('packages/app/src-tauri/src/installer/report.rs')
  const copies: Array<[string, string]> = [
    ['app zh', zh['report.privacy']], ['app en', en['report.privacy']],
    ['site zh', read('packages/site/src/i18n/zh.ts')], ['site en', read('packages/site/src/i18n/en.ts')],
  ]

  it('is checked against a scrubber that really keeps paths', () => {
    expect(rust).toContain('fn a_steam_library_path_survives_because_support_needs_it')
  })

  it.each(copies)('%s never says paths are removed', (_, text) => {
    expect(text).not.toMatch(/no full path|paths? (is|are) (replaced|removed)|不发送完整路径|文件路径会先?被?替换/)
  })

  it('says, in the App, that paths stay and typed text goes as typed', () => {
    expect(en['report.privacy']).toMatch(/paths .* kept/)
    expect(en['report.privacy']).toMatch(/as typed/)
    expect(zh['report.privacy']).toContain('路径会保留')
    expect(zh['report.privacy']).toContain('原样发送')
  })
})
