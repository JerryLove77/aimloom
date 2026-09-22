import type { PlatformAdapter } from "../platform/adapter.js"

export type BackupFile = { original: string; stored: string }
export type BackupEntry = {
  id: string
  label: string
  createdAt: string
  /**
   * 单调递增序号，仅用于 createdAt 相同时的排序兜底。
   * createdAt 只有毫秒精度，同毫秒内创建的多份备份若只按它排序，
   * 顺序会退化成文件系统的目录返回顺序——而「还原最近一次」是用户可见操作，
   * 还原错版本的代价很高。
   */
  seq: number
  files: BackupFile[]
  pristine: boolean
}

const PRISTINE_ID = "pristine"
const MAX_INCREMENTAL = 20
const MANIFEST = "manifest.json"

/** 进程内单调递增。跨进程重启后归零，但那时 createdAt 必然已不同。 */
let seqCounter = 0

const joinPath = (...parts: string[]) => parts.join("/").replace(/\/{2,}/g, "/")
const baseName = (p: string) => p.split(/[/\\]/).pop() ?? p

export class BackupManager {
  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly backupRoot: string,
  ) {}

  /** 首次运行时建立永不删除的原始快照。已存在则为 no-op。 */
  async ensurePristine(files: string[]): Promise<void> {
    const dir = joinPath(this.backupRoot, PRISTINE_ID)
    if (await this.adapter.exists(joinPath(dir, MANIFEST))) return
    await this.writeSnapshot(PRISTINE_ID, files, "首次运行的原始快照", true)
  }

  /** 写入前的增量备份，返回 backupId */
  async snapshot(files: string[], label: string): Promise<string> {
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`
    await this.writeSnapshot(id, files, label, false)
    await this.prune()
    return id
  }

  private async writeSnapshot(
    id: string,
    files: string[],
    label: string,
    pristine: boolean,
  ): Promise<void> {
    const dir = joinPath(this.backupRoot, id)
    await this.adapter.mkdirp(dir)

    const stored: BackupFile[] = []
    for (const [index, original] of files.entries()) {
      if (!(await this.adapter.exists(original))) continue
      // 前缀序号避免不同目录下的同名文件互相覆盖
      const target = joinPath(dir, `${index}-${baseName(original)}`)
      await this.adapter.copyFile(original, target)
      stored.push({ original, stored: target })
    }

    const entry: BackupEntry = {
      id,
      label,
      createdAt: new Date().toISOString(),
      seq: seqCounter++,
      files: stored,
      pristine,
    }
    await this.adapter.writeFileAtomic(
      joinPath(dir, MANIFEST),
      new TextEncoder().encode(JSON.stringify(entry, null, 2)),
    )
  }

  async list(): Promise<BackupEntry[]> {
    if (!(await this.adapter.exists(this.backupRoot))) return []
    const ids = await this.adapter.listDir(this.backupRoot)

    const entries: BackupEntry[] = []
    for (const id of ids) {
      const manifest = joinPath(this.backupRoot, id, MANIFEST)
      if (!(await this.adapter.exists(manifest))) continue
      try {
        const bytes = await this.adapter.readFile(manifest)
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as BackupEntry
        entries.push({ ...parsed, seq: typeof parsed.seq === "number" ? parsed.seq : 0 })
      } catch {
        // 损坏的 manifest 跳过，不影响其余备份可用
      }
    }
    // 先按时间倒序，同毫秒时按 seq 倒序——不留给文件系统的目录顺序决定
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq)
    return entries
  }

  async restore(id: string): Promise<void> {
    const entry = (await this.list()).find((e) => e.id === id)
    if (!entry) throw new Error(`找不到备份: ${id}`)
    for (const file of entry.files) {
      const bytes = await this.adapter.readFile(file.stored)
      await this.adapter.writeFileAtomic(file.original, bytes)
    }
  }

  async restorePristine(): Promise<void> {
    await this.restore(PRISTINE_ID)
  }

  /** 只裁剪增量备份，pristine 永不删除 */
  private async prune(): Promise<void> {
    const incremental = (await this.list()).filter((e) => !e.pristine)
    for (const entry of incremental.slice(MAX_INCREMENTAL)) {
      await this.adapter.removeDir(joinPath(this.backupRoot, entry.id))
    }
  }
}
