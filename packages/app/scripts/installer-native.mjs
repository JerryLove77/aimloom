import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const mode = process.argv[2]
if (mode !== 'build' && mode !== 'dev') {
  console.error('Usage: node scripts/installer-native.mjs build|dev')
  process.exit(64)
}
if (process.platform !== 'win32') {
  console.error('原生安装器只面向 Windows。在 Mac/Linux 上请使用 npm run dev:installer -w @kvk/app 进行浏览器开发预览。')
  process.exit(2)
}
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js')
const appRoot = fileURLToPath(new URL('..', import.meta.url))
const args = [cli, mode, '--features', 'installer-ui', '--config', 'src-tauri/tauri.installer.conf.json']
if (mode === 'build') args.push('--no-bundle', '--target', 'x86_64-pc-windows-msvc', '--config', 'src-tauri/tauri.installer.release.conf.json')
const result = spawnSync(process.execPath, args, { cwd: appRoot, stdio: 'inherit' })
if (result.error) { console.error(result.error.message); process.exit(1) }
process.exit(result.status ?? 1)
