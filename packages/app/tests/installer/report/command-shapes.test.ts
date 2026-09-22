// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createDemoBridge } from '../../../src/installer/demo-bridge'

/**
 * The first report sent from a real screen succeeded and showed an empty report number. Rust
 * returned a bare string; TypeScript read `.number` off it. Every test passed, because the demo
 * bridge returned the object shape TypeScript expected — the two real halves were never compared.
 *
 * `command-shapes.fixture.json` is what compares them. A Rust test (`commands.rs`) serialises
 * each command's real output and requires exactly the fixture's keys. This file requires the same
 * of the demo bridge. And the demo bridge implementing `InstallerBridge` is the compiler's job.
 * So Rust, the fixture, the fake and the contract cannot drift apart one at a time.
 */
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./command-shapes.fixture.json', import.meta.url)), 'utf8')) as Record<string, Record<string, unknown>>
const keys = (value: unknown) => Object.keys(value as object).sort()

describe('what each native command answers has one shape, on both sides', () => {
  const bridge = createDemoBridge()
  const input = { description: 'x', contact: null, attachLog: false, account: null, langChoice: 'system', lang: 'en' as const, gameFound: true }

  it('installer_report_preview', async () => expect(keys(await bridge.reportPreview(input))).toEqual(keys(fixture.installer_report_preview)))
  it('installer_report_send', async () => expect(keys(await bridge.reportSend('0'.repeat(64)))).toEqual(keys(fixture.installer_report_send)))
  it('installer_account_resolve', async () => expect(keys(await bridge.accountResolve('https://steamcommunity.com/id/x'))).toEqual(keys(fixture.installer_account_resolve)))
  it('installer_update_check', async () => expect(keys(await bridge.updateCheck(false))).toEqual(keys(fixture.installer_update_check)))
  it('installer_app_info', async () => expect(keys(await bridge.appInfo())).toEqual(keys(fixture.installer_app_info)))

  it('the fixture names exactly the five commands that answer with data', () => {
    expect(keys(fixture)).toEqual(['installer_account_resolve', 'installer_app_info', 'installer_report_preview', 'installer_report_send', 'installer_update_check'])
  })

  // installer_launch_game answers `Ok(())`/undefined on both sides, like installer_open_logs and
  // installer_open_download -- it belongs beside them, never in the data fixture above.
  it('installer_launch_game answers with nothing, on both sides', async () => {
    expect(await bridge.launchGame()).toBeUndefined()
  })
})
