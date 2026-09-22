import type { PlatformAdapter } from "../platform/adapter.js"
import { decodeText } from "../theme/decode.js"
import { parseTheme } from "../theme/parse.js"
import { resolveCollision, sanitizeFileName } from "./naming.js"

export type InstallThemeOptions = {
  adapter: PlatformAdapter
  themesDir: string
  bytes: Uint8Array
  displayName?: string
  overwrite?: boolean
}

export type InstallThemeResult =
  | { ok: true; fileName: string; canonicalName: string; renamedFrom: string | null }
  | { ok: false; error: string }

const joinPath = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, "")}/${name}`
const stemOf = (file: string) => file.replace(/\.json$/i, "")

/**
 * 安装一个来源不明的 theme 文件（spec §5.4 C1–C3）。
 *
 * 强制令文件名 stem 与内容中的 themeName 相等——实测语料中约 20% 的
 * theme 两者不一致，而 CurrentThemeName 按哪一侧解析尚未确认（§10.0）。
 * 对齐后两种读法得到同一个值，无需依赖该结论。
 */
export async function installTheme(opts: InstallThemeOptions): Promise<InstallThemeResult> {
  const { adapter, themesDir, bytes, displayName, overwrite = false } = opts

  // 1. 先验证这确实是个能用的 theme——校验不通过就不落盘，避免污染目录
  const parsed = parseTheme(bytes, "<incoming>")
  if (!parsed.ok) return { ok: false, error: parsed.error }

  // 2. 拿到原始 JSON 对象。
  //    必须在原始对象上改，不能序列化 parsed.theme——后者是规范化子集，
  //    会丢掉游戏未来版本新增的、我们还不认识的字段。
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(decodeText(bytes).text) as Record<string, unknown>
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${(e as Error).message}` }
  }

  // 3. 确定规范名
  const desired = sanitizeFileName(displayName ?? parsed.theme.name)

  let existingStems: string[] = []
  try {
    existingStems = (await adapter.listDir(themesDir))
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map(stemOf)
  } catch {
    // 目录还不存在，稍后由 mkdirp 创建
  }

  const canonicalName = overwrite ? desired : resolveCollision(desired, existingStems)
  const renamedFrom = canonicalName === desired ? null : desired

  // 4. 身份对齐：内容里的 themeName 改成与文件名一致
  raw.themeName = canonicalName

  // 5. 落盘。统一写成 UTF-8，无论输入是什么编码。
  await adapter.mkdirp(themesDir)
  const fileName = `${canonicalName}.json`
  await adapter.writeFileAtomic(
    joinPath(themesDir, fileName),
    new TextEncoder().encode(JSON.stringify(raw, null, "\t") + "\n"),
  )

  return { ok: true, fileName, canonicalName, renamedFrom }
}
