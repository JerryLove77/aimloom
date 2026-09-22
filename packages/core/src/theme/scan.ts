import type { PlatformAdapter } from "../platform/adapter.js"
import type { Theme } from "../types.js"
import { parseTheme } from "./parse.js"

export type ScanFailure = { path: string; error: string }
export type ScanResult = { themes: Theme[]; failures: ScanFailure[] }

/** 用 posix 分隔符拼接，Windows 上 Tauri 侧同样接受正斜杠 */
const joinPath = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, "")}/${name}`

export async function scanThemes(adapter: PlatformAdapter, themesDir: string): Promise<ScanResult> {
  const entries = await adapter.listDir(themesDir)
  const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith(".json"))

  const themes: Theme[] = []
  const failures: ScanFailure[] = []

  for (const name of jsonFiles) {
    const path = joinPath(themesDir, name)
    try {
      const bytes = await adapter.readFile(path)
      const result = parseTheme(bytes, path)
      if (result.ok) themes.push(result.theme)
      else failures.push({ path: result.path, error: result.error })
    } catch (e) {
      // 读取本身失败（权限、文件被占用），同样隔离，不中断整轮扫描
      failures.push({ path, error: `读取失败: ${(e as Error).message}` })
    }
  }

  themes.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return { themes, failures }
}
