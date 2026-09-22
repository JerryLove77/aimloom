// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../..', import.meta.url))
const repo = fileURLToPath(new URL('../../../..', import.meta.url))
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8')
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

/**
 * The product is Aimloom. What the player sees — the window, the EXE, the app identifier and the
 * data folder — says so. Code identifiers (`kvk-engine.ps1`, `@kvk/app`, `.kvk-installer`) stay:
 * a repo-wide rename is deliberately not done.
 */
describe('the product is named Aimloom wherever a player can see it', () => {
  for (const config of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.installer.conf.json']) {
    it(`${config} names the product, the window and the app`, () => {
      const json = JSON.parse(read(app, config))
      expect(json.productName).toBe('Aimloom')
      expect(json.identifier).toBe('com.aimloom.app')
      for (const window of json.app.windows) expect(window.title).toMatch(/^Aimloom/)
    })
  }

  it('the app version continues the 0.1.x line and is the same everywhere', () => {
    // Decided 2026-09-19: releases are not labelled 0.2.0 yet; they continue from 0.1.x.
    const versions = ['src-tauri/tauri.conf.json', 'src-tauri/tauri.installer.conf.json'].map(config => JSON.parse(read(app, config)).version as string)
    versions.push(/^version = "([^"]+)"/m.exec(read(app, 'src-tauri/Cargo.toml'))![1]!)
    expect(new Set(versions).size).toBe(1)
    expect(versions[0]).toMatch(/^0\.1\.\d+$/)
  })

  it('the page title names it', () => {
    expect(read(app, 'installer.html')).toMatch(/<title>Aimloom[^<]*<\/title>/)
  })

  it('the name is Aimloom alone: the Chinese name 瞄织 was dropped on 2026-09-19', () => {
    const surfaces = [
      ...files(join(app, 'src')).filter(path => /\.(tsx?|css|html)$/.test(path)),
      join(app, 'src-tauri/tauri.conf.json'), join(app, 'src-tauri/tauri.installer.conf.json'), join(app, 'installer.html'),
      join(repo, 'scripts/installer/test-build/channels/test/使用说明.txt'), join(repo, 'scripts/installer/test-build/channels/release/使用说明.txt'),
      join(repo, 'packages/crosshair/cli/prepare-pack.ts'),
    ]
    expect(surfaces.filter(path => readFileSync(path, 'utf8').includes('瞄织')).map(path => path.slice(repo.length))).toEqual([])
  })

  it('no screen still shows an old product name', () => {
    const old = /KVK\s*<span>|KVK Config|KovaaK Config Installer|KVKConfig/
    const hits = files(join(app, 'src')).filter(path => /\.(tsx?|css|html)$/.test(path) && old.test(readFileSync(path, 'utf8')))
    expect(hits.map(path => path.slice(app.length))).toEqual([])
  })

  for (const channel of ['test', 'release']) {
    it(`the ${channel} package ships Aimloom.exe and its readme says so`, () => {
      const readme = read(repo, `scripts/installer/test-build/channels/${channel}/使用说明.txt`)
      expect(readme).toContain('Aimloom.exe')
      expect(readme).toContain('%LOCALAPPDATA%\\Aimloom\\logs')
      expect(readme).toContain('{{VERSION}}')
      expect(readme).not.toMatch(/KVKConfig|KovaaKConfigInstaller/)
    })

    it(`the ${channel} package also ships an English README.txt`, () => {
      const readme = read(repo, `scripts/installer/test-build/channels/${channel}/README.txt`)
      for (const fact of ['Aimloom.exe', 'PowerShell 7', 'WebView2', 'Run anyway', '%LOCALAPPDATA%\\Aimloom', '{{VERSION}}']) {
        expect(readme).toContain(fact)
      }
      // English only: a CJK character here means a line was left untranslated.
      expect(readme).not.toMatch(/[　-〿㐀-䶿一-鿿＀-￯]/)
    })
  }

  it('only the test readme calls the build a test', () => {
    expect(read(repo, 'scripts/installer/test-build/channels/test/使用说明.txt')).toContain('测试版')
    expect(read(repo, 'scripts/installer/test-build/channels/release/使用说明.txt')).not.toContain('测试')
    // The English twin must not call a release build a test either.
    expect(read(repo, 'scripts/installer/test-build/channels/release/README.txt')).not.toMatch(/test build/i)
  })

  it('the release readmes tell the reader where the language setting is', () => {
    expect(read(repo, 'scripts/installer/test-build/channels/release/使用说明.txt')).toContain('「设置」')
    expect(read(repo, 'scripts/installer/test-build/channels/release/README.txt')).toContain('Settings')
  })

  it('the packagers name the EXE Aimloom.exe', () => {
    expect(read(repo, 'scripts/installer/test-build/package-test-build.ps1')).toContain("'Aimloom.exe'")
    expect(read(repo, 'scripts/installer/build-gui-release.py')).toContain("'Aimloom.exe'")
  })

  it('the v0.1 readme points at the Aimloom data folder', () => {
    expect(read(repo, 'scripts/installer/使用说明.txt')).toContain('%LOCALAPPDATA%\\Aimloom\\backups')
  })
})
