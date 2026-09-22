import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))
const CJK = /[　-〿㐀-鿿＀-￯]/

/**
 * The core files the App imports directly (see CLAUDE.md and the Task 6/7 briefs). Every other
 * core module may still carry Chinese error text; only these are scanned. A later task appends
 * its own two enemy files here.
 */
const SCANNED = [
  "src/scheme/document.ts",
  "src/scheme/preview.ts",
  "src/theme/decode.ts",
  "src/types.ts",
  "src/enemy/model.ts",
  "src/enemy/preview.ts",
]

/** True when `node`'s start/end position sits within `range`'s. */
function within(node: ts.Node, range: ts.Node): boolean {
  return node.getStart() >= range.getStart() && node.getEnd() <= range.getEnd()
}

/** The literal is the first argument of `new LocalizedError(zh, en)` (its Chinese half). */
function isLocalizedErrorZhArg(literal: ts.Node): boolean {
  let current: ts.Node | undefined = literal.parent
  while (current) {
    if (ts.isNewExpression(current) && current.expression.getText() === "LocalizedError" && current.arguments && current.arguments.length > 0) {
      if (within(literal, current.arguments[0]!)) return true
    }
    current = current.parent
  }
  return false
}

/** The literal sits in the branch a `lang === 'zh'` (or `"zh"`) test selects. */
function isLangZhBranch(literal: ts.Node): boolean {
  const isZhTest = (expr: ts.Expression): boolean => {
    const text = expr.getText().replace(/\s+/g, "")
    return text === "lang==='zh'" || text === 'lang==="zh"'
  }
  let current: ts.Node = literal
  while (current.parent) {
    const parent: ts.Node = current.parent
    if (ts.isConditionalExpression(parent) && current === parent.whenTrue && isZhTest(parent.condition)) return true
    if (ts.isIfStatement(parent) && within(current, parent.thenStatement) && isZhTest(parent.expression)) return true
    current = parent
  }
  return false
}

/** The literal is the Chinese half of a `{ zh: ..., en: ... }` label map: it sits inside a
 * property named "zh" whose enclosing object literal also has a sibling property named "en". */
function isZhKeyedLabel(literal: ts.Node): boolean {
  let current: ts.Node | undefined = literal.parent
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      const name = current.name.getText().replace(/^['"]|['"]$/g, "")
      if (name === "zh" && ts.isObjectLiteralExpression(current.parent)) {
        const siblings = current.parent.properties
        if (siblings.some(p => ts.isPropertyAssignment(p) && p.name.getText().replace(/^['"]|['"]$/g, "") === "en")) return true
      }
    }
    current = current.parent
  }
  return false
}

/** Every CJK string/template-part literal in a file, with whether it sits in a permitted spot. */
function scan(path: string): { line: number; text: string; allowed: boolean }[] {
  const text = readFileSync(path, "utf8")
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const hits: { line: number; text: string; allowed: boolean }[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && CJK.test(node.text)) {
      const allowed = isLocalizedErrorZhArg(node) || isLangZhBranch(node) || isZhKeyedLabel(node)
      hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.text.trim().slice(0, 50), allowed })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

describe("core i18n messages", () => {
  it("keeps every CJK literal in a LocalizedError, a lang==='zh' branch, or a {zh,en} label map", () => {
    const offenders = SCANNED.flatMap(file => scan(root + file).filter(hit => !hit.allowed).map(hit => `${file}:${hit.line}: ${hit.text}`))
    expect(offenders).toEqual([])
  })

  it("finds at least one CJK literal in document.ts and preview.ts, so the rule is exercised", () => {
    expect(scan(root + "src/scheme/document.ts").length).toBeGreaterThan(0)
    expect(scan(root + "src/scheme/preview.ts").length).toBeGreaterThan(0)
  })
})
