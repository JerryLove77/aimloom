import type { PlatformAdapter } from "../platform/adapter.js"
import { parseTheme } from "../theme/parse.js"

export type PackThemeEntry = { name: string; file: string; ok: boolean; error?: string }

export type PackManifest = {
  root: string
  themes: PackThemeEntry[]
  sounds: string[]
  crosshairs: string[]
  hasPrimaryUserSettings: boolean
  hasUiJson: boolean
  hasPaletteIni: boolean
  readme: string | null
}

export type InstallTargets = { themesDir: string; soundsDir: string; crosshairsDir: string }
export type InstallSelection = { themes: string[]; sounds: string[]; crosshairs: string[] }
export type InstallReport = { copied: number; skipped: { file: string; reason: string }[] }

const joinPath = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, "")}/${name}`

async function listIfExists(adapter: PlatformAdapter, dir: string): Promise<string[]> {
  if (!(await adapter.exists(dir))) return []
  try {
    return await adapter.listDir(dir)
  } catch {
    return []
  }
}

/** 清点一个社区配置包的内容，不做任何写入 */
export async function inspectPack(adapter: PlatformAdapter, packRoot: string): Promise<PackManifest> {
  const themesDir = joinPath(packRoot, "Themes")
  const themeFiles = (await listIfExists(adapter, themesDir)).filter((f) =>
    f.toLowerCase().endsWith(".json"),
  )

  const themes: PackThemeEntry[] = []
  for (const file of themeFiles) {
    const path = joinPath(themesDir, file)
    try {
      const result = parseTheme(await adapter.readFile(path), path)
      themes.push(
        result.ok
          ? { name: result.theme.name, file, ok: true }
          : { name: file.replace(/\.json$/i, ""), file, ok: false, error: result.error },
      )
    } catch (e) {
      themes.push({ name: file, file, ok: false, error: `读取失败: ${(e as Error).message}` })
    }
  }

  let readme: string | null = null
  const readmePath = joinPath(packRoot, "readme.txt")
  if (await adapter.exists(readmePath)) {
    try {
      readme = new TextDecoder().decode(await adapter.readFile(readmePath))
    } catch {
      readme = null
    }
  }

  return {
    root: packRoot,
    themes,
    // 含扩展名的待拷贝文件名，不去重（同名的 .ogg 与 .wav 是两个要各自拷贝的文件）
    sounds: (await listIfExists(adapter, joinPath(packRoot, "sounds")))
      .filter((f) => /\.(ogg|wav)$/i.test(f))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    crosshairs: (await listIfExists(adapter, joinPath(packRoot, "crosshairs")))
      .filter((f) => /\.png$/i.test(f))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    hasPrimaryUserSettings: await adapter.exists(joinPath(packRoot, "PrimaryUserSettings.json")),
    hasUiJson: await adapter.exists(joinPath(packRoot, "UI.json")),
    hasPaletteIni: await adapter.exists(joinPath(packRoot, "Palette.ini")),
    readme,
  }
}

/**
 * 按用户勾选拷贝素材文件。
 * 只碰 Themes / sounds / crosshairs 三类素材，
 * PrimaryUserSettings.json、UI.json、Palette.ini 一律不动——
 * 覆盖那三个文件必须走 applySettingsPatch 的完整管线。
 *
 * C7：单个文件失败不中断整批，已拷贝的保留，失败项记入 skipped。
 */
export async function installPack(
  adapter: PlatformAdapter,
  manifest: PackManifest,
  targets: InstallTargets,
  selection: InstallSelection,
): Promise<InstallReport> {
  const report: InstallReport = { copied: 0, skipped: [] }

  const groups: [string[], string, string][] = [
    [selection.themes, "Themes", targets.themesDir],
    [selection.sounds, "sounds", targets.soundsDir],
    [selection.crosshairs, "crosshairs", targets.crosshairsDir],
  ]

  for (const [files, sourceSubdir, destDir] of groups) {
    if (files.length === 0) continue
    await adapter.mkdirp(destDir)
    for (const file of files) {
      const from = joinPath(joinPath(manifest.root, sourceSubdir), file)
      if (!(await adapter.exists(from))) {
        report.skipped.push({ file, reason: "源文件不存在" })
        continue
      }
      try {
        await adapter.copyFile(from, joinPath(destDir, file))
        report.copied++
      } catch (e) {
        report.skipped.push({ file, reason: (e as Error).message })
      }
    }
  }

  return report
}
