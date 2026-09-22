import { constants } from "node:fs"
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomBytes } from "node:crypto"
import type { FileStat, PlatformAdapter } from "./adapter.js"

export class NodeAdapter implements PlatformAdapter {
  /** 测试用：让 isGameRunning 返回指定值。生产 CLI 保持 false。 */
  constructor(private readonly opts: { gameRunning?: boolean } = {}) {}

  async isGameRunning(): Promise<boolean> {
    return this.opts.gameRunning ?? false
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(path))
  }

  async writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tmp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`)
    const fh = await open(tmp, "w")
    try {
      await fh.write(data)
      await fh.sync() // 确保数据落盘后再 rename，避免断电留下空文件
    } finally {
      await fh.close()
    }
    try {
      await rename(tmp, path)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
  }

  async listDir(path: string): Promise<string[]> {
    return readdir(path)
  }

  async stat(path: string): Promise<FileStat> {
    const s = await stat(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  }

  async mkdirp(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  async copyFile(from: string, to: string): Promise<void> {
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  }

  async removeFile(path: string): Promise<void> {
    await rm(path, { force: true })
  }

  async removeDir(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true })
  }
}
