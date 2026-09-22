import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import { createNativeBridge } from './bridge'
import { createDemoBridge } from './demo-bridge'
import { createNativeProfileBridge } from '../profiles/bridge'
import { createNativeAssetBridge } from '../profiles/assets'
import { createDemoProfileBridge, createDemoAssetBridge } from '../profiles/demo'
import { Workspace } from '../workspace/Workspace'
import { createManualFileDropSource, createNativeFileDropSource, type FileDropSource } from '../workspace/file-drop'
import { LangProvider, browserLanguages, browserStorage, readChoice, resolveLang } from '../i18n'
import './tokens.css'
import './styles.css'

// The first paint must already be in the right language, before React mounts.
document.documentElement.lang = resolveLang(readChoice(browserStorage()), browserLanguages()) === 'zh' ? 'zh-CN' : 'en'

// Browser-only development preview; the native application targets Windows.
const isDemo = !isTauri()
if (isTauri()) {
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen('installer-close-blocked', () => window.dispatchEvent(new Event('kvk-close-blocked'))),
  ).then(unlisten => { import.meta.hot?.dispose(unlisten) }).catch(error => console.error('Could not listen for the native window state', error))
}
// Explorer drops reach the app only through Tauri, with real paths. The browser demo has no
// paths to offer, so it exposes a hand-driven source for previews: window.__kvkDemoDrops.emit(...).
let fileDrops: FileDropSource
if (isDemo) {
  const manual = createManualFileDropSource()
  ;(window as unknown as { __kvkDemoDrops?: typeof manual }).__kvkDemoDrops = manual
  fileDrops = manual
} else fileDrops = createNativeFileDropSource()
const root = document.getElementById('root')
if (!root) throw new Error('App mount point #root not found')
const reactRoot = createRoot(root)
reactRoot.render(<StrictMode><LangProvider><Workspace bridge={isDemo ? createDemoBridge() : createNativeBridge()} profileBridge={isDemo ? createDemoProfileBridge() : createNativeProfileBridge()} assetBridge={isDemo ? createDemoAssetBridge() : createNativeAssetBridge()} isDemo={isDemo} fileDrops={fileDrops} /></LangProvider></StrictMode>)
import.meta.hot?.dispose(() => reactRoot.unmount())
