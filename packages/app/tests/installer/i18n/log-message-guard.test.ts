// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Spec §2.3: every App message that names `worker.log` also names the way out — the in-app
 * report action (「发送问题报告」 / "Send a report") or `feedback@aimloom.dev`. `WORKER_EXITED` /
 * `WORKER_EXITED_EN` (Rust) and the engine's fixed English fallback (PowerShell) already carry
 * both; this guard keeps it that way and catches a future regression anywhere else that names
 * the file — the two dictionaries, the Rust installer sources and the shipped PowerShell.
 */
const app = fileURLToPath(new URL('../../../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

const wayOut = (text: string): boolean =>
  text.includes('发送问题报告') || text.includes('feedback@aimloom.dev') || /send a report/i.test(text)

/**
 * Keys whose value names `worker.log` but is not itself an "operation failed, here's the log"
 * message — it is a label *inside* the report-sending UI, which is the way out. Exempting a key
 * requires this comment to say why; the set must stay this small.
 */
const EXEMPT_DICTIONARY_KEYS = new Set<string>([
  // The "attach the log" checkbox's hint, inside ReportSheet — the surrounding sheet IS the way out.
  'report.attachLog.hint',
])

/** Every string-literal property value of a top-level object-literal export, keyed by property name. */
function dictionaryEntries(path: string): Map<string, string> {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const entries = new Map<string, string>()
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) && ts.isStringLiteralLike(node.initializer))
      entries.set(node.name.text, node.initializer.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return entries
}

describe('a dictionary message naming worker.log also names the way out', () => {
  // This guard has already passed vacuously once: a mis-parse desynchronised the Rust extractor
  // and the mutation that should have turned it red came back green. So each scan below carries
  // a canary — a known hit it must find — and cannot pass on an empty or broken extraction.
  for (const file of ['src/i18n/zh.ts', 'src/i18n/en.ts']) {
    it(`${file}: the scan really read the dictionary, and every exemption is still earning its place`, () => {
      const entries = dictionaryEntries(join(app, file))
      expect(entries.size).toBeGreaterThan(500)
      for (const key of EXEMPT_DICTIONARY_KEYS) {
        // An exemption for a key that is gone, or that no longer names the log, is dead weight
        // that would silently excuse a future string reusing the key.
        expect(entries.get(key), `${key} is exempted but missing from ${file}`).toBeDefined()
        expect(entries.get(key), `${key} is exempted but no longer names worker.log`).toContain('worker.log')
      }
    })
    it(file, () => {
      const offenders = [...dictionaryEntries(join(app, file))]
        .filter(([key, value]) => value.includes('worker.log') && !EXEMPT_DICTIONARY_KEYS.has(key) && !wayOut(value))
        .map(([key, value]) => `${key}: ${value}`)
      expect(offenders).toEqual([])
    })
  }
})

/**
 * Every Rust string literal that reads as prose (contains a space) — excludes bare path segments
 * like "worker.log" itself. Handles both `"…"` (with `\"`/`\\` escapes) and `r"…"` raw strings
 * (no escapes at all — a raw string is only misread as an escaped one when it happens to end in
 * a backslash right before its closing quote, e.g. `r"\\?\"`, so the two forms cannot share one
 * naive pattern).
 */
function rustProseLiterals(text: string): string[] {
  const withoutTestMod = text.split(/\nmod tests\b/)[0]!
  const withoutComments = withoutTestMod.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n')
  const STRING = /r"[^"]*"|"(?:[^"\\]|\\.)*"/g
  return [...withoutComments.matchAll(STRING)]
    .map(m => (m[0].startsWith('r"') ? m[0].slice(2, -1) : m[0].slice(1, -1)))
    .filter(s => s.includes(' '))
}

describe('a Rust installer message naming worker.log also names the way out', () => {
  const dir = join(repoRoot, 'packages/app/src-tauri/src/installer')
  const files = readdirSync(dir).filter(f => f.endsWith('.rs'))
  it('the extractor still finds the two messages known to name the log (canary)', () => {
    // WORKER_EXITED and WORKER_EXITED_EN live below a raw string that once threw the extractor
    // off for the rest of the file. If they are not found, nothing after them is being checked.
    const hits = rustProseLiterals(readFileSync(join(dir, 'worker.rs'), 'utf8')).filter(s => s.includes('worker.log'))
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })
  for (const file of files) {
    it(file, () => {
      const literals = rustProseLiterals(readFileSync(join(dir, file), 'utf8'))
      const offenders = literals.filter(s => s.includes('worker.log') && !wayOut(s))
      expect(offenders).toEqual([])
    })
  }
})

/** Every PowerShell line that is not a pure comment line (a line whose trimmed text starts with `#`). */
function nonCommentLines(text: string): string[] {
  return text.split('\n').filter(line => !/^\s*#/.test(line))
}

describe('a shipped PowerShell message naming worker.log also names the way out', () => {
  const dir = join(repoRoot, 'scripts/installer')
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n)
    if (statSync(p).isDirectory()) return n === 'tests' ? [] : walk(p)
    return p.endsWith('.ps1') ? [p] : []
  })
  const files = walk(dir)
  it('scanned at least the engine and the GUI worker/service scripts', () => {
    expect(files.length).toBeGreaterThan(5)
  })
  it('the scan still sees the engine line known to name the log (canary)', () => {
    const engine = files.find(f => f.endsWith('kvk-engine.ps1'))
    expect(engine).toBeDefined()
    const hits = nonCommentLines(readFileSync(engine!, 'utf8')).filter(line => line.includes('worker.log'))
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
  for (const file of files) {
    it(file.slice(dir.length + 1), () => {
      const offenders = nonCommentLines(readFileSync(file, 'utf8')).filter(line => line.includes('worker.log') && !wayOut(line))
      expect(offenders).toEqual([])
    })
  }
})
