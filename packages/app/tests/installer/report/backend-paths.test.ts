// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The App's first real report failed with a 404: it posted to `/report`, and the backend's route
 * is `/api/reports`. Nothing had ever compared the two. The Rust tests talk to a local server
 * that answers any path, and the payload's contract fixture pins the body, not where it goes —
 * so five reviews and 1300 tests passed over a path that could never have worked.
 *
 * This reads the paths out of the native layer and checks each one against the Worker that is
 * actually deployed from this repository.
 */
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const net = readFileSync(root + 'packages/app/src-tauri/src/installer/net.rs', 'utf8')
const worker = readFileSync(root + 'packages/site/src/worker/index.ts', 'utf8')

function path(name: string): string {
  const found = new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(net)?.[1]
  expect(found, `${name} is not declared in net.rs`).toBeTruthy()
  return found!
}

describe('every path the App calls exists on the backend', () => {
  it.each(['REPORTS_PATH', 'STEAM_RESOLVE_PATH'])('%s is a route the Worker handles', name => {
    const p = path(name)
    expect(p.startsWith('/api/'), `${p} is outside /api/, so the Worker hands it to the static site`).toBe(true)
    expect(worker, `the Worker has no route for ${p}`).toContain(`pathname === '${p}'`)
  })

  it('LATEST_PATH is a page the site builds', () => {
    const p = path('LATEST_PATH')
    expect(p).toBe('/latest.json')
    expect(existsSync(root + 'packages/site/src/pages' + p + '.ts')).toBe(true)
  })

  it('no call site spells a path by hand instead of using the constants', () => {
    // A literal at a call site is how /report got in. Tests inside `mod tests` may use any path.
    for (const file of ['report.rs', 'commands.rs']) {
      const source = readFileSync(root + 'packages/app/src-tauri/src/installer/' + file, 'utf8').split(/\nmod tests\b/)[0]!
      // Only calls on the HTTP client: serde_json's `.get("field")` is not a backend path.
      const literals = [...source.matchAll(/\bhttp\.(?:post_json|get)\(\s*"([^"]*)"/g)].map(m => m[1])
      expect(literals, `${file} calls the backend with a hand-written path`).toEqual([])
    }
  })
})
