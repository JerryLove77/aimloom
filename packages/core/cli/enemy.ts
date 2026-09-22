import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { parseSettings } from "../src/settings/settings-doc.js"
import { parseTheme } from "../src/theme/parse.js"
import { decodeText } from "../src/theme/decode.js"
import { enemyColorToHex, parseEnemyDocument, prepareEnemyReplacement, readEnemyAppearance, renderEnemySvg } from "../src/enemy/index.js"

// Development tooling only. No write to the supplied settings and no installer runtime dependency.
async function main(): Promise<void> {
  const [command, settingsPath, enemyPath, outputPath, schemePath, ...extra] = process.argv.slice(2)
  if (!["preview", "prepare"].includes(command ?? "") || !settingsPath || !enemyPath || !outputPath || extra.length || (command === "prepare" && schemePath)) {
    throw new Error("用法：npm run enemy -w @kvk/core -- preview|prepare <当前设置.json> <enemy.json> <新输出文件> [预览背景主题.json]")
  }
  const bytes = await readFile(settingsPath)
  const settings = parseSettings(bytes)
  const enemy = parseEnemyDocument(decodeText(await readFile(enemyPath)).text)
  let output: string
  if (command === "preview") {
    const options: { title: string; background?: string; floor?: string } = { title: enemy.name }
    if (schemePath) {
      const parsed = parseTheme(await readFile(schemePath), schemePath)
      if (!parsed.ok) throw new Error(parsed.error)
      options.background = enemyColorToHex(parsed.theme.wall.tint)
      options.floor = enemyColorToHex(parsed.theme.floor.tint)
    }
    output = renderEnemySvg(readEnemyAppearance(settings), enemy.appearance, options)
  } else {
    const prepared = prepareEnemyReplacement(settings, enemy.appearance)
    output = JSON.stringify({ schemaVersion: 1, kind: "enemy-settings-patch", name: enemy.name,
      sourceSettingsSha256: createHash("sha256").update(bytes).digest("hex"), patch: prepared.patch }, null, 2) + "\n"
    for (const change of prepared.changes) console.log(`${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`)
    console.log(`待替换 ${prepared.changes.length} 项；尚未写入游戏。`)
  }
  // Exclusive creation also blocks symlink/input overwrite. Users select a new output per review.
  await writeFile(outputPath, output, { flag: "wx" })
  console.log(`已导出：${outputPath}`)
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
