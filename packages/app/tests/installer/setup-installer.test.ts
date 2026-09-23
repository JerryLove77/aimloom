// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tauri = fileURLToPath(new URL('../../src-tauri/', import.meta.url))
const read = (path: string) => readFileSync(tauri + path, 'utf8').replace(/\r\n/g, '\n')
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi at tag tauri-cli-v2.11.4, LF. */
const UPSTREAM_SHA256 = '20f4ecc730defb71f1342eaeaec4021df13be3d843abba0effe88ea5835fa079'
const UPSTREAM_LINE = '      StrCpy $INSTDIR "$LOCALAPPDATA\\${PRODUCTNAME}"'
const OUR_LINE = '      StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\${PRODUCTNAME}"'

/**
 * Tauri installs a per-user app to %LOCALAPPDATA%\<productName>, which for Aimloom is the data
 * folder: backups, Profiles and logs. Installing there would mix program files with backups and
 * make the old KovaaKConfigInstaller folder impossible to adopt (data_root in worker.rs).
 */
describe('the NSIS template', () => {
  const template = read('windows/installer.nsi')

  it('installs per user under Programs, never into the data folder', () => {
    expect(template.split('\n').filter(line => line === OUR_LINE)).toHaveLength(1)
    expect(template).not.toContain(UPSTREAM_LINE)
  })

  it('is Tauri 2.11.4\'s own template with only that line changed', () => {
    expect(sha256(template.replace(OUR_LINE, UPSTREAM_LINE))).toBe(UPSTREAM_SHA256)
  })

  it('deletes recursively only the WebView state named by the bundle id', () => {
    const recursive = template.split('\n').filter(line => /rmdir\s+\/r\b/i.test(line)).map(line => line.trim())
    expect(recursive).toEqual(['RmDir /r "$APPDATA\\${BUNDLEID}"', 'RmDir /r "$LOCALAPPDATA\\${BUNDLEID}"'])
  })

  it('stays tied to the pinned CLI it was copied from', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'))
    expect({ ...pkg.dependencies, ...pkg.devDependencies }['@tauri-apps/cli']).toBe('2.11.4')
  })
})

describe('the PowerShell 7 hook', () => {
  const hooks = read('windows/hooks.nsh')
  const macro = /^!macro NSIS_HOOK_POSTINSTALL$([\s\S]*?)^!macroend$/m.exec(hooks)?.[1] ?? ''

  it('runs after the files are in place', () => expect(macro).not.toBe(''))

  it('looks where the App looks: 64-bit Program Files first, then PATH, and needs a major version of 7+', () => {
    expect(hooks).toContain('"$PROGRAMFILES64\\PowerShell\\7\\pwsh.exe"')
    expect(hooks).not.toMatch(/\$PROGRAMFILES\\PowerShell/)
    expect(hooks).toMatch(/SearchPath \$R0 "pwsh\.exe"/)
    expect(hooks).toMatch(/nsExec::ExecToStack \/OEM '"\$R0" -NoProfile -NonInteractive -Command/)
    expect(hooks).toContain('-NoProfile -NonInteractive -Command "$$PSVersionTable.PSVersion.Major"')
    expect(hooks).toMatch(/\$\{If\} \$R2 >= 7/)
  })

  it('reads the child process as OEM bytes, not UTF-16, in every nsExec call', () => {
    const calls = [...hooks.matchAll(/nsExec::Exec\S*\s+(?!\/OEM\b).*/g)].map(m => m[0])
    expect(calls).toEqual([])
  })

  it('never asks, downloads or raises UAC in a silent or passive install', () => {
    expect(macro.indexOf('${Silent}')).toBeGreaterThan(-1)
    expect(macro.indexOf('$PassiveMode = 1')).toBeGreaterThan(-1)
    expect(macro.indexOf('Call AimloomOfferPwsh')).toBeGreaterThan(macro.indexOf('$PassiveMode = 1'))
    expect(hooks).toMatch(/MessageBox MB_YESNO\|MB_ICONQUESTION "\$R1" \/SD IDNO IDYES/)
  })

  it('asks in the installer\'s language: Chinese for 2052, English otherwise', () => {
    expect(hooks).toContain('!define AIMLOOM_PWSH_ASK_ZH "Aimloom 需要 PowerShell 7。现在用 winget 安装吗？需要联网；Windows 会请求管理员权限。"')
    expect(hooks).toContain('!define AIMLOOM_PWSH_ASK_EN "Aimloom needs PowerShell 7. Install it now with winget? This needs an internet connection, and Windows will ask for administrator permission."')
    expect(hooks).toMatch(/\$\{If\} \$LANGUAGE == 2052/)
    const english = [...hooks.matchAll(/!define AIMLOOM_\w+_EN "([^"]+)"/g)].map(m => m[1])
    expect(english.length).toBeGreaterThanOrEqual(4)
    for (const text of english) expect(text).not.toMatch(/[　-〿㐀-鿿＀-￯“”‘’]/)
  })

  it('installs with exactly the approved winget command', () => {
    expect(hooks).toContain('!define AIMLOOM_WINGET_ARGS "install --id Microsoft.PowerShell --exact --source winget --accept-package-agreements --accept-source-agreements"')
  })

  it('tells a player still without PowerShell 7 exactly what the App tells them, in both languages', () => {
    const rust = readFileSync(tauri + 'src/installer/worker.rs', 'utf8')
    for (const [constant, define] of [['PWSH_MISSING', 'AIMLOOM_PWSH_MISSING_ZH'], ['PWSH_MISSING_EN', 'AIMLOOM_PWSH_MISSING_EN']] as const) {
      const app = new RegExp(`const ${constant}: &str = "([^"]+)";`).exec(rust)?.[1]
      const nsis = new RegExp(`!define ${define} "([^"]+)"`).exec(hooks)?.[1]
      expect(app, constant).toBeTruthy()
      expect(nsis, define).toBe(app)
    }
  })

  it('never elevates itself or touches the execution policy', () => {
    expect(hooks).not.toMatch(/RequestExecutionLevel|ExecutionPolicy|runas|UAC_/i)
  })

  it('hands $R9 back to the template, as the pre-install hook does', () => {
    expect(macro).toContain('Push $R9')
    expect(macro).toContain('Pop $R9')
  })

  it('proves winget runs before offering it, instead of trusting the alias stub', () => {
    const offer = /^Function AimloomOfferPwsh$([\s\S]*?)^FunctionEnd$/m.exec(hooks)?.[1] ?? ''
    // Every App Execution Alias exists as a zero-byte reparse point, so FileExists alone is
    // true on a machine without App Installer. The version probe must come first, its exit
    // code must be the gate, and the install must sit behind that gate.
    const probe = offer.indexOf('--version')
    const gate = offer.indexOf('$R2 == "0"')
    const install = offer.indexOf('${AIMLOOM_WINGET_ARGS}')
    expect(probe).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(probe)
    expect(install).toBeGreaterThan(gate)
    // Registers borrowed for the probe go back too.
    for (const r of ['$R0', '$R1', '$R2', '$R3']) {
      expect(offer, r).toContain(`Push ${r}`)
      expect(offer, r).toContain(`Pop ${r}`)
    }
  })
})

/**
 * The directory page lets a player browse anywhere, and NSIS appends the product name: choosing
 * %LOCALAPPDATA% would install into %LOCALAPPDATA%\\Aimloom, the data folder. The template has
 * already run `SetOutPath $INSTDIR` (which creates the folder) when the pre-install hook runs,
 * so the hook must also take the empty folder away again, or the old folder can no longer be adopted.
 */
describe('the data-folder guard', () => {
  const hooks = read('windows/hooks.nsh')
  const macro = /^!macro NSIS_HOOK_PREINSTALL$([\s\S]*?)^!macroend$/m.exec(hooks)?.[1] ?? ''

  it('runs before any file is copied', () => expect(macro).not.toBe(''))
  it('refuses the data folder under both of its names, and anything inside them', () => {
    expect(macro).toContain('"$LOCALAPPDATA\\Aimloom"')
    expect(macro).toContain('"$LOCALAPPDATA\\KovaaKConfigInstaller"')
    expect(macro.match(/Call AimloomInsideDataDir/g)?.length).toBe(2)
    const fn = /^Function AimloomInsideDataDir$([\s\S]*?)^FunctionEnd$/m.exec(hooks)?.[1] ?? ''
    expect(fn).toContain('$INSTDIR == $R8')   // the folder itself
    expect(fn).toContain('"$R8\\"')            // or a path that starts with it and a backslash
  })
  it('stops the install, and removes only what is empty', () => {
    expect(macro).toMatch(/SetCurrentDirectoryW\(w "\$TEMP"\)[\s\S]*RMDir "\$INSTDIR"[\s\S]*\n\s*Abort\b/)
    expect(hooks).not.toMatch(/RMDir\s+\/r/i)
    expect(hooks).not.toMatch(/\bDelete\b/)
  })
  it('never names another output folder: 7-Zip and scanners read SetOutPath statically', () => {
    // With `SetOutPath "$TEMP"` in the refusal branch, 7-Zip listed every packed file, Aimloom.exe
    // included, under $TEMP\\ (seen on the first rc.2 build). Nothing ran differently, but an
    // installer that appears to drop its EXE into TEMP invites a false positive.
    expect(hooks.replace(/^\s*;.*$/gm, '')).not.toMatch(/SetOutPath/)
  })
  it('explains itself in the installer\'s language, and says nothing in a silent install', () => {
    expect(macro).toMatch(/\$\{IfNot\} \$\{Silent\}[\s\S]*AIMLOOM_TEXT \$R8 DATADIR[\s\S]*MessageBox/)
    expect(hooks).toMatch(/^!define AIMLOOM_DATADIR_ZH ".*数据文件夹.*"$/m)
    const en = /^!define AIMLOOM_DATADIR_EN "(.*)"$/m.exec(hooks)?.[1] ?? ''
    expect(en).toMatch(/data folder/)
    expect(en).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/)
  })
  it('hands every register it uses back to the template', () => {
    for (const r of ['$R6', '$R7', '$R8', '$R9']) {
      expect(macro, r).toContain(`Push ${r}`)
      expect(macro, r).toContain(`Pop ${r}`)
    }
  })
})

describe('the Setup bundle configuration', () => {
  const release = JSON.parse(read('tauri.installer.release.conf.json'))
  const installer = JSON.parse(read('tauri.installer.conf.json'))

  it('builds one per-user NSIS installer, English first then Chinese, from our template and hook', () => {
    expect(release.bundle.targets).toEqual(['nsis'])
    expect(release.bundle.windows.nsis).toEqual({
      template: 'windows/installer.nsi', installerHooks: 'windows/hooks.nsh',
      installMode: 'currentUser', languages: ['English', 'SimpChinese'],
    })
  })

  it('fetches WebView2 only when missing, quietly, and no longer ships a fixed runtime', () => {
    expect(release.bundle.windows.webviewInstallMode).toEqual({ type: 'downloadBootstrapper', silent: true })
    expect(JSON.stringify(release)).not.toContain('fixedRuntime')
  })

  it('names the installed program Aimloom.exe, as the ZIP does', () => {
    expect(installer.mainBinaryName).toBe('Aimloom')
  })

  it('declares no static resources: the payload is the packaged folder, passed at bundle time', () => {
    expect(release.bundle.resources).toBeUndefined()
    expect(installer.bundle.resources).toBeUndefined()
  })

  it('is version 0.1.5', () => expect(installer.version).toBe('0.1.5'))
})
