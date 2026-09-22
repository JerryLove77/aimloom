import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** 仓库内唯一的真实样本，测试只读不写 */
const PACK_SOURCE = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../KVK Settings 2025",
)

/**
 * 合成音效文件名。二进制素材不进版本库，因此这些名字是刻意构造的，
 * 覆盖的边界情况比随便挑几个真实文件更狠：
 *   - 空格、连字符、下划线、前导数字
 *   - 非 ASCII（真实语料里有 Smári-ctrl 这类）
 *   - 大小写混合（Windows/macOS 文件系统不区分大小写）
 *   - 同名的 .ogg 与 .wav（去重用）
 *   - .ogg.sfk 波形缓存（必须被排除，它不是音效）
 * 文件内容是占位字节——内核不解析音频，只看文件名与扩展名。
 */
const SYNTHETIC_SOUNDS = [
  "Q3Railgun.ogg",
  "hitsound_Osu.ogg",
  "saya_kick_deeper.ogg",
  "Bell5.ogg",
  "spawn05.ogg",
  "Vice Hit 18.ogg",
  "bubble pop 1.ogg",
  "119415__joedeshon__rocker-switch.ogg",
  "OWheadshot.ogg",
  "CritOW.ogg",
  "音效测试.ogg",
  "Smári-hit.ogg",
  "MixedCase.ogg",
  "Health Hit 3.ogg",
  "Health Hit 3.wav", // 与上一行同名，listSounds 必须去重
  "Tommy Shot 1.ogg",
  "Tommy Shot 1.wav", // 同上
  "TBell.ogg.sfk", // 波形缓存，必须被排除
  "Aimgod_Hitsound.ogg.sfk", // 同上
]

/** 合成准星文件名，同样刻意带空格、连字符、非 ASCII 与 .png~ 备份诱饵 */
const SYNTHETIC_CROSSHAIRS = [
  "default.png",
  "dot.png",
  "01_plus.png",
  "KovaaK-Crosshair - Copy.png",
  "Windows Cursor.png",
  "MonkOrb1 103fov.png",
  "准星测试.png",
  "MixedCase.png",
  "mycrosshair.png",
  "mycrosshair.png~", // 编辑器备份，不是准星
]

export type FixtureHandle = {
  /** 临时根目录，模拟游戏安装目录 */
  root: string
  themesDir: string
  soundsDir: string
  crosshairsDir: string
  settingsPath: string
  uiPath: string
  palettePath: string
  cleanup(): Promise<void>
}

async function writePlaceholders(dir: string, names: readonly string[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  await Promise.all(names.map((n) => writeFile(join(dir, n), Buffer.alloc(16))))
}

/**
 * 搭出一个模拟的游戏安装目录：
 *   <root>/FPSAimTrainer/crosshairs                        （合成）
 *   <root>/FPSAimTrainer/sounds                            （合成）
 *   <root>/FPSAimTrainer/Saved/SaveGames/Themes            （真实语料副本）
 *   <root>/FPSAimTrainer/Saved/SaveGames/PrimaryUserSettings.json
 *
 * Themes 与三个配置文件从真实 pack 复制——它们是解析器的语料，
 * 含 UTF-16、缺字段、文件名与 themeName 不一致等真实边界情况。
 * 音效与准星是合成的，见上方两个常量。
 */
export async function makeFixture(): Promise<FixtureHandle> {
  const root = await mkdtemp(join(tmpdir(), "kvk-fixture-"))
  const game = join(root, "FPSAimTrainer")
  const saveGames = join(game, "Saved", "SaveGames")

  await cp(join(PACK_SOURCE, "Themes"), join(saveGames, "Themes"), { recursive: true })
  await cp(join(PACK_SOURCE, "PrimaryUserSettings.json"), join(saveGames, "PrimaryUserSettings.json"))
  await cp(join(PACK_SOURCE, "UI.json"), join(saveGames, "UI.json"))
  await cp(join(PACK_SOURCE, "Palette.ini"), join(root, "Palette.ini"))

  await writePlaceholders(join(game, "sounds"), SYNTHETIC_SOUNDS)
  await writePlaceholders(join(game, "crosshairs"), SYNTHETIC_CROSSHAIRS)

  return {
    root,
    themesDir: join(saveGames, "Themes"),
    soundsDir: join(game, "sounds"),
    crosshairsDir: join(game, "crosshairs"),
    settingsPath: join(saveGames, "PrimaryUserSettings.json"),
    uiPath: join(saveGames, "UI.json"),
    palettePath: join(root, "Palette.ini"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/**
 * 搭一个模拟的社区配置包（inspectPack / installPack 用）。
 * 结构与玩家分享的压缩包一致：Themes/ + sounds/ + crosshairs/ + 三个配置文件 + readme。
 */
export async function makePackFixture(): Promise<FixtureHandle> {
  const root = await mkdtemp(join(tmpdir(), "kvk-pack-"))

  await cp(join(PACK_SOURCE, "Themes"), join(root, "Themes"), { recursive: true })
  await cp(join(PACK_SOURCE, "PrimaryUserSettings.json"), join(root, "PrimaryUserSettings.json"))
  await cp(join(PACK_SOURCE, "UI.json"), join(root, "UI.json"))
  await cp(join(PACK_SOURCE, "Palette.ini"), join(root, "Palette.ini"))
  await cp(join(PACK_SOURCE, "readme.txt"), join(root, "readme.txt"))

  await writePlaceholders(join(root, "sounds"), SYNTHETIC_SOUNDS)
  await writePlaceholders(join(root, "crosshairs"), SYNTHETIC_CROSSHAIRS)

  return {
    root,
    themesDir: join(root, "Themes"),
    soundsDir: join(root, "sounds"),
    crosshairsDir: join(root, "crosshairs"),
    settingsPath: join(root, "PrimaryUserSettings.json"),
    uiPath: join(root, "UI.json"),
    palettePath: join(root, "Palette.ini"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
