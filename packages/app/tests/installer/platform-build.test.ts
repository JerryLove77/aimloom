// @vitest-environment node
import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script=fileURLToPath(new URL('../../scripts/installer-native.mjs',import.meta.url))
it.skipIf(process.platform==='win32')('rejects native installer builds on a Mac/Linux development host',()=>{
 const result=spawnSync(process.execPath,[script,'build'],{encoding:'utf8'})
 expect(result.status).toBe(2)
 expect(result.stderr).toContain('Windows')
 expect(result.stderr).toContain('dev:installer')
})

it('keeps native drag-and-drop on for the installer window',async()=>{
 // Explorer drops reach the app only as Tauri events with real paths; with this off, WebView2
 // would deliver HTML5 drops that carry no path, and adding a file by dragging would die silently.
 const {readFileSync}=await import('node:fs')
 const config=JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/tauri.installer.conf.json',import.meta.url)),'utf8'))
 expect(config.app.windows[0].dragDropEnabled).toBe(true)
 const capability=JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/capabilities/installer.json',import.meta.url)),'utf8'))
 // core:default carries the event-listen permission the drop listener needs.
 expect(capability.permissions).toContain('core:default')
})
