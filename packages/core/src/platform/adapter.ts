export type FileStat = { size: number; mtimeMs: number }

/**
 * 内核访问外界的唯一出口。生产环境由 TauriAdapter 实现（计划 B），
 * 测试与 CLI 由 NodeAdapter 实现。领域逻辑不得绕过此接口。
 */
export interface PlatformAdapter {
  isGameRunning(): Promise<boolean>
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<Uint8Array>
  /** 必须是原子写：先写临时文件，落盘后再 rename */
  writeFileAtomic(path: string, data: Uint8Array): Promise<void>
  listDir(path: string): Promise<string[]>
  stat(path: string): Promise<FileStat>
  mkdirp(path: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  removeFile(path: string): Promise<void>
  removeDir(path: string): Promise<void>
}
