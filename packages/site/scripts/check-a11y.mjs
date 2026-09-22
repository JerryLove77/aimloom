// Runs axe over every built page at 1280 and 390 px. One-time setup: npx playwright install chromium
// dist/ is served over HTTP because the pages reference /_astro/*.css absolutely; under file://
// they would be audited unstyled. Usage: node scripts/check-a11y.mjs dist [--shots <dir>]
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const dist = resolve(process.argv[2] ?? 'dist')
const shotsAt = process.argv.indexOf('--shots')
const shots = shotsAt > 0 ? resolve(process.argv[shotsAt + 1] ?? 'shots') : null
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' }

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = resolve(join(dist, path))
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const routes = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name === 'index.html') routes.push('/' + relative(dist, dir).split(sep).filter(Boolean).map(s => s + '/').join(''))
  }
})(dist)
routes.sort()

const browser = await chromium.launch()
let failures = 0
for (const route of routes) {
  for (const width of [1280, 390]) {
    // JavaScript is off so the bare root stays on the language chooser instead of redirecting.
    const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: route !== '/' })
    const page = await context.newPage()
    await page.goto(origin + route)
    if (route !== '/') {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      for (const v of results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')) {
        failures++
        console.error(`${route} @${width}: ${v.id} — ${v.help} (${v.nodes.length} nodes): ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 0) { failures++; console.error(`${route} @${width}: horizontal overflow of ${overflow}px`) }
    }
    if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${route.replace(/\//g, '_') || '_'}${width}.png`), fullPage: true }) }
    await context.close()
  }
}
await browser.close()
server.close()
console.log(`${routes.length} pages × 2 widths, ${failures} serious/critical violations or overflows`)
process.exit(failures === 0 ? 0 : 1)
