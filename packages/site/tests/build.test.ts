import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const dist = join(root, 'dist')
const page = (rel: string) => readFileSync(join(dist, rel, 'index.html'), 'utf8')

beforeAll(() => {
  execFileSync('npx', ['astro', 'build'], { cwd: root, stdio: 'pipe' })
}, 180_000)

describe('build output', () => {
  const routes = ['zh', 'zh/download', 'zh/guide', 'zh/crosshair', 'zh/changelog', 'zh/privacy', 'en', 'en/download', 'en/guide', 'en/crosshair', 'en/changelog', 'en/privacy']

  it('emits the chooser and twelve localized pages', () => {
    expect(existsSync(join(dist, 'index.html'))).toBe(true)
    for (const r of routes) expect(existsSync(join(dist, r, 'index.html')), r).toBe(true)
  })

  it('sets <html lang> per language', () => {
    for (const r of routes) {
      const html = page(r)
      expect(html, r).toContain(r.startsWith('zh') ? '<html lang="zh-CN"' : '<html lang="en"')
    }
  })

  it('links every page to its counterpart in the other language', () => {
    expect(page('zh/download')).toContain('href="/en/download/"')
    expect(page('en/guide')).toContain('href="/zh/guide/"')
  })

  it('links Explore from every page\'s nav, and builds the two shells the Worker fills', () => {
    for (const r of routes) expect(page(r), r).toContain(r.startsWith('zh') ? '<a href="/zh/explore/">探索</a>' : '<a href="/en/explore/">Explore</a>')
    for (const l of ['zh', 'en']) {
      for (const shell of [`${l}/explore`, `${l}/explore/item-shell`]) {
        const html = page(shell)
        expect(html, shell).toContain('id="explore-root"'); expect(html, shell).toContain(`<a href="/${l}/explore/" aria-current="page">`)
      }
    }
  })
  it('allows the explorer\'s file origin for images and sound, and nothing else new', () => {
    const headers = readFileSync(join(dist, '_headers'), 'utf8')
    expect(headers).toContain("img-src 'self' data: https://dl.aimloom.dev; media-src 'self' https://dl.aimloom.dev;")
    // Cloudflare Turnstile, the human check on uploads: its script and its frame, nothing else.
    expect(headers).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com;")
  })

  it('loads nothing from the network', () => {
    for (const r of ['', ...routes]) {
      const html = page(r)
      expect(html, r).not.toMatch(/(src|href)="https?:\/\/(?!github\.com)/)
    }
  })

  it('home follows the spec order: hero, features, flow, faq, closing download', () => {
    const html = page('zh')
    const order = ['id="hero"', 'id="features"', 'id="flow"', 'id="faq"', 'id="closing"'].map(m => html.indexOf(m))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('home hides the showcase while showcase.json is empty', () => {
    expect(page('zh')).not.toContain('id="showcase"')
  })
  it('home offers the 0.1.4 Setup from the site itself, in the hero and the closing block, and no ZIP', () => {
    for (const r of ['zh', 'en']) {
      const html = page(r)
      expect(html.match(/data-download-state="stable"/g)?.length, r).toBe(2)
      expect(html.match(/<a[^>]+href="\/files\/Aimloom-Setup-v0\.1\.4\.exe"[^>]*\sdownload[\s>]/g)?.length, r).toBe(2)
      expect(html, r).not.toMatch(/href="[^"]+\.zip"/)
    }
    expect(page('en')).toContain('One setup for each way you train.')
  })
  it('download page shows the stable release, the Setup first and the portable ZIP second, both hashes, and no source link', () => {
    for (const r of ['zh/download', 'en/download']) {
      const html = page(r)
      expect(html, r).toContain('data-download-state="stable"')
      expect(html.match(/href="[^"]+\.(exe|zip)"/g), r).toEqual(['href="/files/Aimloom-Setup-v0.1.4.exe"', 'href="/files/Aimloom-v0.1.4.zip"'])
      expect(html, r).toContain('aef57e8284b3a68ebb0eb09bbcba10122c3b920e4c9c79bc3758e34369a0095a')
      expect(html, r).toContain('8020db50161b59de4dee51c9f754bc7b7840298c68f4580f31b0c167e8165c14')
      expect(html, r).toContain('id="first-step"')
      expect(html, r).toContain('id="source"')
      expect(html, r).not.toContain('id="beta"')
      expect(html, r).not.toMatch(/github\.com/)
    }
  })
  it('guide exposes its six anchors in both languages and points at the Aimloom data folder', () => {
    for (const r of ['zh/guide', 'en/guide']) {
      const html = page(r)
      for (const id of ['install', 'apply', 'add-files', 'in-game', 'backup', 'trouble']) expect(html, `${r}#${id}`).toContain(`id="${id}"`)
      expect(html, r).toContain('%LOCALAPPDATA%\\Aimloom\\backups')
    }
  })
  it('explains what Aimloom sends, from which version, in both languages', () => {
    const zh = page('zh/privacy'), en = page('en/privacy')
    for (const s of ['0.1.2', 'aimloom.dev', '180', 'feedback@aimloom.dev']) { expect(zh, s).toContain(s); expect(en, s).toContain(s) }
    expect(en).toMatch(/never uploads game files, settings, Profiles or backups/)
    expect(zh).toContain('从不上传游戏文件、设置、Profile 或备份')
    expect(en).toMatch(/No IP address is stored/); expect(zh).toContain('不保存 IP 地址')
  })
  it('gives the Privacy page the FlowStep and Notice components its approved design specifies', () => {
    for (const r of ['zh/privacy', 'en/privacy']) {
      const html = page(r)
      const when = html.match(/<section id="when">[\s\S]*?<\/section>/)?.[0] ?? ''
      expect(when, r).toMatch(/<ol class="steps">(\s*<li><span>[^<]*<\/span><\/li>\s*){3}<\/ol>/)
      expect(html, r).not.toContain('<ul class="bullets">')
      for (const id of ['versions', 'sent', 'never', 'kept', 'contact']) {
        const section = html.match(new RegExp(`<section id="${id}">[\\s\\S]*?<\\/section>`))?.[0] ?? ''
        expect(section, `${r}#${id}`).toMatch(/<p class="notice">/)
      }
    }
  })
  it('gives the Privacy page the table of contents its design has, linked to real sections', () => {
    for (const r of ['zh/privacy', 'en/privacy']) {
      const html = page(r)
      const toc = html.match(/<nav class="toc"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? ''
      const ids = [...toc.matchAll(/href="#([a-z-]+)"/g)].map(m => m[1])
      expect(ids, r).toEqual(['versions', 'when', 'sent', 'never', 'kept', 'explore', 'signin', 'contact'])
      for (const id of ids) expect(html, `${r}#${id}`).toContain(`id="${id}"`)
      expect(toc, r).toContain(r.startsWith('zh') ? '本页内容' : 'On this page')
    }
  })
  it('links the Privacy page from every footer, in the page\'s language', () => {
    for (const r of routes) {
      const footer = page(r).match(/<footer class="footer"[^>]*>([\s\S]*?)<\/footer>/)?.[1] ?? ''
      expect(footer, r).toContain(r.startsWith('zh') ? '<a href="/zh/privacy/">隐私说明</a>' : '<a href="/en/privacy/">Privacy</a>')
    }
  })
  it('answers "does it use the network" on the home page', () => {
    expect(page('en')).toMatch(/Does Aimloom use the network\?/); expect(page('zh')).toContain('Aimloom 会联网吗？')
  })

  it('changelog shows 0.1.4 and 0.1.3 above the withdrawn 0.1.2 and 0.1.1, each dated, linking to the download page, not to a file', () => {
    const html = page('en/changelog')
    expect(html.indexOf('v0.1.4')).toBeGreaterThan(-1)
    expect(html.indexOf('v0.1.4')).toBeLessThan(html.indexOf('v0.1.3'))
    expect(html.indexOf('v0.1.3')).toBeLessThan(html.indexOf('v0.1.2'))
    expect(html.indexOf('v0.1.2')).toBeLessThan(html.indexOf('v0.1.1'))
    expect(html).toContain('Stable · 2026-09-22')
    expect(html).toContain('Withdrawn · 2026-09-20')
    expect(html).toContain('Withdrawn · 2026-09-19')
    expect(html).toContain('href="/en/download/"')
    expect(html).not.toMatch(/href="[^"]+\.(zip|exe)"/)
  })
  it('no page describes the old console installer', () => {
    for (const r of ['', ...routes]) {
      const html = page(r)
      for (const gone of ['安装配置.cmd', '恢复配置.cmd', 'KovaaKConfigInstaller', 'KVK Settings', 'release-manifest.json']) expect(html, `${r}: ${gone}`).not.toContain(gone)
    }
  })
  it('names the product Aimloom alone on every page: the Chinese name was dropped on 2026-09-19', () => {
    for (const r of ['', ...routes]) expect(page(r), r).not.toContain('瞄织')
  })
  it('every footer explains the name, in English on both languages\' pages', () => {
    const origin = '<p lang="en">Aim + loom: weave your background, sounds, crosshair and enemy look into one setup.</p>'
    for (const r of routes) {
      const footer = page(r).match(/<footer class="footer"[^>]*>([\s\S]*?)<\/footer>/)?.[1] ?? ''
      expect(footer, r).toContain(origin)
      expect(footer, r).not.toMatch(/无关联|not affiliated|trademark|商标/)
    }
  })
  it('every footer gives the feedback address as a mail link, labelled in the page\'s language', () => {
    // The App and the guide tell a player to "send us" worker.log; until v0.1.3's one-click report
    // this address is the only place to send it. It is a Cloudflare Email Routing address: it must
    // receive mail BEFORE a deploy advertises it.
    const link = '<a href="mailto:feedback@aimloom.dev">feedback@aimloom.dev</a>'
    for (const r of routes) {
      const footer = page(r).match(/<footer class="footer"[^>]*>([\s\S]*?)<\/footer>/)?.[1] ?? ''
      expect(footer, r).toContain((r.startsWith('zh') ? '问题反馈：' : 'Feedback: ') + link)
    }
  })
  it('the guide says where to send a report, in both languages', () => {
    expect(page('zh/guide')).toContain('发邮件到 feedback@aimloom.dev')
    expect(page('en/guide')).toContain('email feedback@aimloom.dev')
  })
  it('the Chinese headline says what the English one does: one setup for each way you train', () => {
    expect(page('zh')).toMatch(/<h1[^>]*>每种练法，一套配置。<\/h1>/)
    expect(page('zh')).not.toContain('你的准星，你的风格')
  })
  it('the English pages say the app is bilingual, not Chinese-only', () => {
    expect(page('en')).toMatch(/The app is in Chinese and English/)
    expect(page('en')).not.toMatch(/The app(&#39;|')s interface is in Chinese\./)
  })

  it('crosshair tool page states it runs locally, never uploads, and links to the App download', () => {
    for (const r of ['zh/crosshair', 'en/crosshair']) {
      const html = page(r)
      expect(html, r).toContain('id="cx-app"')
      expect(html, r).toContain('id="cx-code"')
      expect(html, r).toContain('id="cx-download-btn"')
      expect(html, r).toContain(`href="/${r.split('/')[0]}/download/"`)
    }
    expect(page('zh/crosshair')).toContain('不会上传')
    expect(page('en/crosshair')).toMatch(/nothing is uploaded/i)
    expect(page('zh/crosshair')).toContain('静态近似')
    expect(page('en/crosshair')).toMatch(/static approximation/i)
  })
  it('crosshair tool page loads its interactive script only from the site itself', () => {
    for (const r of ['zh/crosshair', 'en/crosshair']) {
      const html = page(r)
      const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]!)
      expect(scripts.length, r).toBeGreaterThan(0)
      for (const src of scripts) expect(src, r).toMatch(/^\/_astro\//)
    }
  })

  it('ships the security headers file with the assets', () => {
    const headers = readFileSync(join(dist, '_headers'), 'utf8')
    expect(headers).toContain("Content-Security-Policy: default-src 'self'")
    expect(headers).toContain('X-Content-Type-Options: nosniff')
  })

  it('publishes latest.json with the recommended version and the beta field, uncached, as a static file', () => {
    const latest = JSON.parse(readFileSync(join(dist, 'latest.json'), 'utf8'))
    const data = JSON.parse(readFileSync(join(root, 'src', 'data', 'releases.json'), 'utf8'))
    const release = (data.releases as { version: string; status: string }[]).find(r => r.version === data.recommended) ?? null
    // Mirrors src/pages/latest.json.ts's own condition: `preparing` (or no recommendation at all) means
    // no download exists yet, so the endpoint must answer `null`, not a version the App cannot fetch.
    // The `preparing` branch itself is unit-tested with a stub in tests/latest-json.test.ts, since the
    // real releases.json currently recommends a release and this build fixture can't reach it.
    // The committed releases.json currently has no beta, so this also pins `beta: null` here; the
    // beta-present and finished-beta cases are unit-tested with stubs in
    // tests/latest-json-beta.test.ts and tests/latest-json-finished-beta.test.ts.
    expect(latest).toEqual({ version: release !== null && release.status !== 'preparing' ? release.version : null, beta: data.beta ?? null })
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toMatch(/^\/latest\.json\n {2}Cache-Control: no-cache$/m)
  })
})
