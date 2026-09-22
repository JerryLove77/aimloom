// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scripts = fileURLToPath(new URL('../../../../../scripts/installer/', import.meta.url))
const FILES = ['kvk-engine.ps1', 'kvk-audio.ps1', 'kvk-crosshair.ps1', 'kvk-enemy.ps1', 'kvk-scheme.ps1', 'kvk-import.ps1', 'kvk-profile-apply.ps1', 'gui/kvk-gui-service.ps1']
const CJK = /[㐀-鿿]/
const STR = String.raw`("(?:[^"\x60]|\x60.)*"|'(?:[^']|'')*')`
const CALL = new RegExp(String.raw`Throw-Kvk(?:Failure|GuiIssue)\s+'[A-Z_]+'\s+${STR}\s+${STR}`, 'g')

describe('every engine and service message has English', () => {
  for (const file of FILES) {
    const lines = readFileSync(scripts + file, 'utf8').split('\n')
    it(`${file}: each Throw-KvkFailure / Throw-KvkGuiIssue passes Chinese then English`, () => {
      const bad: string[] = []
      lines.forEach((line, i) => {
        if (/^\s*#/.test(line) || !/Throw-Kvk(?:Failure|GuiIssue)\s+'/.test(line) || /^\s*function /.test(line)) return
        if (/#\s*i18n-checked\s*$/.test(line)) return
        const calls = [...line.matchAll(CALL)]
        const count = (line.match(/Throw-Kvk(?:Failure|GuiIssue)\s+'/g) ?? []).length
        if (calls.length !== count || calls.some(c => CJK.test(c[2]!))) bad.push(`${i + 1}: ${line.trim().slice(0, 100)}`)
      })
      expect(bad).toEqual([])
    })
    it(`${file}: no bare throw carries Chinese`, () => {
      expect(lines.map((l, i) => [i + 1, l] as const).filter(([, l]) => /\bthrow\s+["']/.test(l) && CJK.test(l)).map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([])
    })
  }
})

/**
 * ROADMAP I18N-NAMES. Game content — a file name, a theme name, a Profile name, a path — is
 * never translated and may well be Chinese, so an English message wraps every such value in
 * double quotes (`" inside a PowerShell double-quoted string). Every layer's English filter
 * then accepts CJK *inside* quoted spans and still rejects an untranslated sentence.
 *
 * The list below is the complete set of interpolations allowed to stand OUTSIDE quotes in an
 * English literal, derived by reading every English message in the files above. They are JSON
 * keys and sections, fixed English field labels, operation codes, and numeric limits — never a
 * name or a path. Anything else must be quoted, so a new `$file` or `$path` fails here.
 */
const UNQUOTED_OK = new Set([
  // JSON / settings keys and sections
  'Key', 'key', '($edit.Key)', '($definition.Key)', '($flag[0])', '($property.Name)', 'Section', 'section', 'channel',
  // Fixed English field labels and request field names (always ASCII)
  'Label', 'label', 'LabelEn', 'field', 'FieldName', 'n', 'wantedEn', 'folder',
  // Codes: an audio event, an operation, an install category
  'Event', 'Op', 'op', 'c', 'category',
  // A scheme surface, always one of wall|floor|ceiling|ramp — see kvk-scheme.ps1 (`${lower}Material`)
  'lower',
  // Numbers and nested exception text
  'Min', 'Max', '($_.Exception.Message)',
])

/** The parts of a PowerShell double-quoted literal that lie outside its `"…`" spans. */
function outsideQuotedSpans(literal: string): string[] {
  const parts = literal.slice(1, -1).split('`"')
  const last = parts.length - 1
  return parts.filter((_, i) => !(i % 2 === 1 && i !== last))
}

/**
 * Every `$…` interpolation in a segment, as it is written after the `$`. PowerShell has three
 * forms and all three must be seen: `$name` (with `.member` / `[index]` tails), `$(…)` and the
 * brace form `${name}` — the last one carries no `(` or letter straight after the `$`, so a
 * regex that demands one lets an unquoted `${fileName}` through.
 */
function interpolations(segment: string): string[] {
  const TOKEN = /\$(?:\{([A-Za-z_][^}]*)\}|(\([^)]*\)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+|\[[^\]]*\])*))/g
  return [...segment.matchAll(TOKEN)].map(m => (m[1] ?? m[2])!)
}

const ENGLISH_LITERAL = new RegExp(String.raw`(?:Throw-Kvk(?:Failure|GuiIssue)\s+'[A-Z_]+'\s+${STR}\s+${STR}|\bthrow\s+${STR})`, 'g')

/** Every interpolation a line leaves outside quotes in its English literal, without the allow-list. */
function unquotedInterpolations(line: string): string[] {
  if (/^\s*#/.test(line)) return []
  const found: string[] = []
  for (const call of line.matchAll(ENGLISH_LITERAL)) {
    // A Throw-Kvk… call carries Chinese then English; a bare throw is English already.
    const english = call[2] ?? call[3]
    if (!english || !english.startsWith('"')) continue
    for (const segment of outsideQuotedSpans(english)) found.push(...interpolations(segment))
  }
  return found
}

describe('the unquoted-interpolation guard sees every PowerShell interpolation form', () => {
  const call = (literal: string) => `    Throw-KvkFailure 'ENGINE_ERROR' '中文。' ${literal}`
  it('refuses the brace form `${fileName}` outside quotes', () => {
    expect(unquotedInterpolations(call('"The file ${fileName} was not found."'))).toEqual(['fileName'])
  })
  it('still refuses the bare and sub-expression forms', () => {
    expect(unquotedInterpolations(call('"The file $fileName was not found."'))).toEqual(['fileName'])
    expect(unquotedInterpolations(call('"The file $($row.Path) was not found."'))).toEqual(['($row.Path)'])
  })
  it('accepts a brace form that stays inside quotes', () => {
    expect(unquotedInterpolations(call('"The file `"${fileName}`" was not found."'))).toEqual([])
  })
})

describe('English messages quote every name and path they interpolate', () => {
  for (const file of FILES) {
    const lines = readFileSync(scripts + file, 'utf8').split('\n')
    it(`${file}: a name or path outside quotes is refused`, () => {
      const bad: string[] = []
      lines.forEach((line, i) => {
        for (const token of unquotedInterpolations(line)) {
          if (!UNQUOTED_OK.has(token)) bad.push(`${i + 1}: $${token} in ${line.trim().slice(0, 90)}`)
        }
      })
      expect(bad).toEqual([])
    })
  }
})
