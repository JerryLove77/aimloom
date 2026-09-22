// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const app = fileURLToPath(new URL('../../../', import.meta.url))
const CJK = /[　-〿㐀-鿿＀-￯]/
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

/** Files whose strings have not moved into src/i18n yet. The migration is finished, so this list is empty and must stay empty: new UI strings go into src/i18n/. */
const NOT_YET_MIGRATED = new Set<string>([])

/** Chinese inside string literals, template parts and JSX text. Comments are not tokens here, so they are ignored. */
function chineseLiterals(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && CJK.test(node.text)) {
      hits.push(`${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.text.trim().slice(0, 40)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

describe('UI code carries no Chinese outside src/i18n', () => {
  const files = walk(join(app, 'src')).filter(p => /\.tsx?$/.test(p)).map(p => relative(app, p).replaceAll('\\', '/')).filter(p => !p.startsWith('src/i18n/'))

  it('has no Chinese literal in a migrated file', () => {
    const offenders = files.filter(f => !NOT_YET_MIGRATED.has(f)).flatMap(f => chineseLiterals(join(app, f)).map(h => `${f}:${h}`))
    expect(offenders).toEqual([])
  })
  it('lists no file that is already clean, so the list only shrinks', () => {
    expect([...NOT_YET_MIGRATED].filter(f => chineseLiterals(join(app, f)).length === 0)).toEqual([])
  })
  it('has migrated every file', () => {
    expect([...NOT_YET_MIGRATED]).toEqual([])
  })
})
