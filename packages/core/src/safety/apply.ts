import type { PlatformAdapter } from "../platform/adapter.js"
import type { SettingsPatch } from "../types.js"
import { filterPatch } from "../settings/field-policy.js"
import { NEVER_WRITE } from "../settings/keys.js"
import { applyPatch, parseSettings, serializeSettings } from "../settings/settings-doc.js"
import type { BackupManager } from "./backup.js"
import { partitionByExistence } from "./integrity.js"

export type ApplyOptions = {
  adapter: PlatformAdapter
  backup: BackupManager
  settingsPath: string
  patch: SettingsPatch
  allow: ReadonlySet<string>
  label: string
  /** 目标文件中不存在的键：true（默认）跳过并报告，false 则新增 */
  skipUnknownKeys?: boolean
}

export type ApplyResult =
  | { ok: true; backupId: string; written: string[]; rejected: string[]; unknownKeys: string[] }
  | {
      ok: false
      reason: "game-running" | "verify-failed" | "io-error"
      message: string
      rolledBack: boolean
    }

/**
 * 唯一会改动用户存档的入口。管线：
 *   守卫 → 过滤 → 读取 → pristine + 备份 → 未知键分流 → 原子写 → 写后校验 → 失败回滚
 */
export async function applySettingsPatch(opts: ApplyOptions): Promise<ApplyResult> {
  const { adapter, backup, settingsPath, patch, allow, label } = opts

  // 1. 守卫：游戏退出时会用内存中的设置回写覆盖磁盘，运行中写入等于白写
  if (await adapter.isGameRunning()) {
    return {
      ok: false,
      reason: "game-running",
      message: "KovaaK 正在运行。请完全退出游戏后再应用设置——否则游戏退出时会覆盖掉本次改动。",
      rolledBack: false,
    }
  }

  // 2. 过滤：白名单准入 + 黑名单剔除
  const { patch: safe, rejected } = filterPatch(patch, allow)

  // 3. 读取当前存档
  let before: Uint8Array
  try {
    before = await adapter.readFile(settingsPath)
    parseSettings(before) // 先确认当前文件本身合法，否则不动它
  } catch (e) {
    return {
      ok: false,
      reason: "io-error",
      message: `读取 PrimaryUserSettings.json 失败: ${(e as Error).message}`,
      rolledBack: false,
    }
  }

  // 4. pristine + 增量备份
  let backupId: string
  try {
    await backup.ensurePristine([settingsPath])
    backupId = await backup.snapshot([settingsPath], label)
  } catch (e) {
    return {
      ok: false,
      reason: "io-error",
      message: `备份失败，已中止写入: ${(e as Error).message}`,
      rolledBack: false,
    }
  }

  // 5. 未知键分流（C5）：目标文件里不存在的键默认跳过，避免掩盖映射表过时
  const doc = parseSettings(before)
  const { known, unknown } = partitionByExistence(doc, safe)
  const effective = opts.skipUnknownKeys === false ? safe : known
  const unknownKeys = opts.skipUnknownKeys === false ? [] : unknown
  const written = Object.values(effective).flatMap((section) => Object.keys(section ?? {}))

  // 6. 原子写
  const next = applyPatch(doc, effective)
  try {
    await adapter.writeFileAtomic(settingsPath, serializeSettings(next))
  } catch (e) {
    const rolledBack = await rollback(backup, backupId)
    return { ok: false, reason: "io-error", message: `写入失败: ${(e as Error).message}`, rolledBack }
  }

  // 7. 写后校验：重新读回，确认 JSON 合法、目标键已生效、黑名单键分毫未动
  try {
    const verifyDoc = parseSettings(await adapter.readFile(settingsPath))
    const problem = verify(verifyDoc.raw, next.raw, doc.raw)
    if (problem) {
      const rolledBack = await rollback(backup, backupId)
      return { ok: false, reason: "verify-failed", message: problem, rolledBack }
    }
  } catch (e) {
    const rolledBack = await rollback(backup, backupId)
    return {
      ok: false,
      reason: "verify-failed",
      message: `写后校验失败，文件无法解析: ${(e as Error).message}`,
      rolledBack,
    }
  }

  return { ok: true, backupId, written, rejected, unknownKeys }
}

async function rollback(backup: BackupManager, backupId: string): Promise<boolean> {
  try {
    await backup.restore(backupId)
    return true
  } catch {
    return false
  }
}

/** 返回问题描述，或 null 表示校验通过 */
function verify(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  original: Record<string, unknown>,
): string | null {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return "写入后的文件内容与预期不符"
  }
  for (const section of ["floatSettings", "integerSettings", "stringSettings"] as const) {
    const before = original[section] as Record<string, unknown> | undefined
    const after = actual[section] as Record<string, unknown> | undefined
    for (const key of NEVER_WRITE) {
      if (before && key in before && after?.[key] !== before[key]) {
        return `黑名单字段被改动: ${key}`
      }
    }
  }
  return null
}
