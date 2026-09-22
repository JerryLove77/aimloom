import { lstat, open, readFile, unlink } from "node:fs/promises"
import { resolve } from "node:path"
import { composeSchemeTheme, parseScheme, prepareSchemeReplacement, renderSchemePreview, serializeScheme } from "../src/scheme/index.js"
import { parseSettings } from "../src/settings/settings-doc.js"

const help = `Scheme 开发工具（只导出文件，不应用到游戏）
node --import tsx packages/core/cli/scheme.ts --input <主题或scheme.json> [输出选项]
  --preview <新文件.svg>                 导出近似预览
  --save <新文件.json>                   保存可编辑的 scheme
  --base-theme <基础主题.json> --export-theme <新主题.json>
                                        替换背景，保留基础主题的敌人及其他字段
  --settings <PrimaryUserSettings.json> --review <新文件.json>
                                        导出候选设置与未验证绑定提示，不写游戏
所有输出必须是尚不存在的文件；应用与撤销由现有安装引擎负责。`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 1 && argv[0] === "--help") { console.log(help); return }
  const allowed = ["--input", "--preview", "--save", "--base-theme", "--export-theme", "--settings", "--review"]
  const args = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!, value = argv[index + 1]
    if (!allowed.includes(flag) || !value || value.startsWith("--") || args.has(flag)) throw new Error(`参数无效或重复: ${flag}\n${help}`)
    args.set(flag, value)
  }
  if (!args.has("--input")) throw new Error(`缺少 --input\n${help}`)
  if (args.has("--base-theme") !== args.has("--export-theme")) throw new Error("--base-theme 和 --export-theme 必须同时提供")
  if (args.has("--settings") !== args.has("--review")) throw new Error("--settings 和 --review 必须同时提供")
  const outputFlags = ["--preview", "--save", "--export-theme", "--review"].filter((flag) => args.has(flag))
  if (!outputFlags.length) throw new Error("请至少选择一种输出")
  const paths = outputFlags.map((flag) => resolve(args.get(flag)!))
  if (new Set(paths.map((path) => process.platform === "linux" ? path : path.toLowerCase())).size !== paths.length) throw new Error("输出路径不能重复")
  for (const path of paths) {
    try {
      await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    throw new Error(`输出已存在，拒绝覆盖: ${path}`)
  }
  const doc = parseScheme(await readFile(args.get("--input")!))
  const outputs = new Map<string, string | Uint8Array>()
  if (args.has("--preview")) outputs.set("--preview", renderSchemePreview(doc))
  if (args.has("--save")) outputs.set("--save", serializeScheme(doc))
  if (args.has("--export-theme")) outputs.set("--export-theme", composeSchemeTheme(await readFile(args.get("--base-theme")!), doc))
  if (args.has("--review")) {
    const settings = parseSettings(await readFile(args.get("--settings")!))
    const review = prepareSchemeReplacement(settings, doc)
    outputs.set("--review", JSON.stringify(review, null, 2) + "\n")
  }
  // Read and validate every input before output creation. Exclusive opens close preflight races.
  const created: string[] = []
  try {
    for (const [flag, data] of outputs) {
      const path = resolve(args.get(flag)!)
      const handle = await open(path, "wx")
      created.push(path)
      try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    }
  } catch (error) {
    for (const path of created.reverse()) await unlink(path).catch(() => undefined)
    throw error
  }
  console.log(JSON.stringify({ exported: created, warnings: doc.warnings, nativeApplicationPerformed: false, gameActivation: "unverified" }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
