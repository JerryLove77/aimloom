// Walks dist/ and verifies every internal href/src resolves to a built file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(process.argv[2] ?? 'dist')
const pages = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.html')) pages.push(p)
  }
})(dist)

let broken = 0
for (const file of pages) {
  const html = readFileSync(file, 'utf8')
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = m[1]
    if (/^(https?:|mailto:|#|data:)/.test(url)) continue
    const [path] = url.split(/[?#]/)
    const target = path.startsWith('/') ? join(dist, path) : join(file, '..', path)
    const ok = existsSync(target) && (statSync(target).isFile() || existsSync(join(target, 'index.html')))
    if (!ok) { broken++; console.error(`${file.slice(dist.length)}: broken ${url}`) }
  }
}
console.log(`${pages.length} pages, ${broken} broken links`)
process.exit(broken === 0 ? 0 : 1)
