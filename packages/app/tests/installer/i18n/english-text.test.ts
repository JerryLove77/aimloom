// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hasCjk, isEnglishText } from '../../../src/i18n'
import { engineErrorText, executionErrorText, installerIssueMsg } from '../../../src/installer/issue'
import { errorMsg } from '../../../src/workspace/issue-text'

/**
 * The shared parity table (ROADMAP I18N-NAMES). "English-safe" means: no CJK outside
 * double-quoted spans, where a span is `"…"` (ASCII double quotes, no nesting) and an odd
 * number of quotes leaves the unclosed tail *outside*. The same ten cases, in the same
 * order and with the same verdicts, are asserted on all three layers:
 *   PowerShell  scripts/installer/tests/engine.test.ps1  ('the English-safe parity table …')
 *   Rust        packages/app/src-tauri/src/installer/protocol.rs  (english_parity_table)
 *   TypeScript  this file
 * Changing one row means changing all three.
 */
export const PARITY: readonly (readonly [name: string, text: string, english: boolean])[] = [
  ['plain English', 'The source file was not found.', true],
  ['Chinese sentence', '找不到来源文件。', false],
  ['English with a quoted Chinese name', 'The Themes folder already has "中文主题.json".', true],
  ['quoted Chinese plus Chinese outside', 'The Themes folder already has "中文主题.json"，请换一个文件名。', false],
  ['unbalanced quote', 'The Themes folder already has "中文主题.json', false],
  ['empty', '   ', false],
  ['full-width punctuation outside quotes', 'The source file was not found！', false],
  ['only quotes', '""', true],
  ['a closed span then an unclosed one', 'a "中" b "中', false],
  ['a newline inside a span', '"中\n文" ok', true],
]

describe('isEnglishText — the shared parity table', () => {
  for (const [name, text, english] of PARITY) {
    it(`${name}: ${english ? 'English-safe' : 'not English-safe'}`, () => {
      expect(isEnglishText(text)).toBe(english)
    })
  }
  it('hasCjk stays the raw character test, unchanged by quoting', () => {
    expect(hasCjk('The Themes folder already has "中文主题.json".')).toBe(true)
    expect(hasCjk('plain English')).toBe(false)
  })
})

/**
 * End-to-end (requirement 3): a refusal about a Chinese-named file keeps its English wording,
 * because the name travels inside quotes. Before this change every one of these fell back to a
 * generic line and an English player never learned which file was refused.
 */
describe('an English message that names a Chinese file reaches the English UI', () => {
  const zh = 'Themes 文件夹里已经有「中文主题.json」，添加不会覆盖它；请换一个文件名。'
  const en = 'The Themes folder already has "中文主题.json", and adding never overwrites it. Choose another file name.'

  it('errorMsg keeps the issue English', () => {
    expect(errorMsg({ code: 'ENGINE_ERROR', message: zh, messageEn: en }, { key: 'common.error.planStale' })).toEqual({ zh, en })
  })
  it('installerIssueMsg keeps the issue English', () => {
    expect(installerIssueMsg({ code: 'ENGINE_ERROR', message: zh, messageEn: en, path: null })).toEqual({ zh, en })
  })
  it('engineErrorText keeps a raw English line that names the file', () => {
    expect(engineErrorText('en', en)).toBe(en)
    expect(engineErrorText('en', zh)).not.toBe(zh)
  })
  it('executionErrorText prefers the English twin that names the file', () => {
    expect(executionErrorText('en', zh, en)).toBe(en)
  })
})
