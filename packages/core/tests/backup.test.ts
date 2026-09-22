import { describe, it, expect } from "vitest"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NodeAdapter } from "../src/platform/node-adapter.js"
import { BackupManager } from "../src/safety/backup.js"
import { makeFixture } from "./helpers/fixture.js"

describe("BackupManager", () => {
  it("ensurePristine 建立首份快照，重复调用不覆盖", async () => {
    const fx = await makeFixture()
    try {
      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "backups"))
      await mgr.ensurePristine([fx.settingsPath])

      await writeFile(fx.settingsPath, '{"tampered":true}')
      await mgr.ensurePristine([fx.settingsPath]) // 第二次调用必须是 no-op

      await mgr.restorePristine()
      const restored = JSON.parse(await readFile(fx.settingsPath, "utf-8"))
      expect(restored.stringSettings["EStringSettingId::CurrentThemeName"]).toBe("clover-alternate")
    } finally {
      await fx.cleanup()
    }
  })

  it("snapshot 后修改文件，restore 能还原", async () => {
    const fx = await makeFixture()
    try {
      // fixture.ts's corpus differs between the private repo (real values) and the public
      // export (neutral synthetic ones) -- read the expected value from the fixture itself.
      const original = JSON.parse(await readFile(fx.settingsPath, "utf-8"))
      const originalXSens = original.floatSettings["EFloatSettingId::XSens"]

      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "backups"))
      const id = await mgr.snapshot([fx.settingsPath], "apply theme 3 AM")

      await writeFile(fx.settingsPath, '{"broken":1}')
      await mgr.restore(id)

      const restored = JSON.parse(await readFile(fx.settingsPath, "utf-8"))
      expect(restored.floatSettings["EFloatSettingId::XSens"]).toBe(originalXSens)
    } finally {
      await fx.cleanup()
    }
  })

  it("list 按时间倒序返回，携带 label", async () => {
    const fx = await makeFixture()
    try {
      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "backups"))
      await mgr.snapshot([fx.settingsPath], "first")
      await mgr.snapshot([fx.settingsPath], "second")

      const list = await mgr.list()
      const incremental = list.filter((e) => !e.pristine)
      expect(incremental).toHaveLength(2)
      expect(incremental[0]!.label).toBe("second")
      expect(incremental[1]!.label).toBe("first")
    } finally {
      await fx.cleanup()
    }
  })

  it("增量备份保留最近 20 份，pristine 不被裁剪", async () => {
    const fx = await makeFixture()
    try {
      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "backups"))
      await mgr.ensurePristine([fx.settingsPath])
      for (let i = 0; i < 25; i++) await mgr.snapshot([fx.settingsPath], `run ${i}`)

      const list = await mgr.list()
      expect(list.filter((e) => !e.pristine)).toHaveLength(20)
      expect(list.filter((e) => e.pristine)).toHaveLength(1)
      expect(list.filter((e) => !e.pristine)[0]!.label).toBe("run 24")
    } finally {
      await fx.cleanup()
    }
  })

  it("restore 不存在的 id 抛出明确错误", async () => {
    const fx = await makeFixture()
    try {
      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "backups"))
      await expect(mgr.restore("nope")).rejects.toThrow(/找不到备份/)
    } finally {
      await fx.cleanup()
    }
  })

  it("多文件备份：不同目录下的同名文件不互相覆盖", async () => {
    const fx = await makeFixture()
    try {
      const a = join(fx.root, "dirA", "same.json")
      const b = join(fx.root, "dirB", "same.json")
      const adapter = new NodeAdapter()
      await adapter.writeFileAtomic(a, new TextEncoder().encode('{"which":"A"}'))
      await adapter.writeFileAtomic(b, new TextEncoder().encode('{"which":"B"}'))

      const mgr = new BackupManager(adapter, join(fx.root, "backups"))
      const id = await mgr.snapshot([a, b], "two files with the same basename")

      await writeFile(a, "destroyed")
      await writeFile(b, "destroyed")
      await mgr.restore(id)

      expect(JSON.parse(await readFile(a, "utf-8")).which).toBe("A")
      expect(JSON.parse(await readFile(b, "utf-8")).which).toBe("B")
    } finally {
      await fx.cleanup()
    }
  })

  it("不存在的文件被跳过，不影响其余文件的备份", async () => {
    const fx = await makeFixture()
    try {
      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "backups"))
      const id = await mgr.snapshot([fx.settingsPath, join(fx.root, "ghost.json")], "with a ghost")

      const entry = (await mgr.list()).find((e) => e.id === id)!
      expect(entry.files).toHaveLength(1)
      expect(entry.files[0]!.original).toBe(fx.settingsPath)
    } finally {
      await fx.cleanup()
    }
  })

  it("createdAt 相同时按 seq 排序，不依赖文件系统的目录顺序", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const root = join(fx.root, "backups")
      const sameInstant = "2026-09-03T00:00:00.000Z"

      // 手工写三份 createdAt 完全相同的 manifest。目录名故意让字母序与 seq 相反，
      // 以证明排序确实用了 seq 而不是目录顺序。
      const write = async (dirName: string, seq: number, label: string) =>
        adapter.writeFileAtomic(
          join(root, dirName, "manifest.json"),
          new TextEncoder().encode(
            JSON.stringify({
              id: dirName,
              label,
              createdAt: sameInstant,
              seq,
              files: [],
              pristine: false,
            }),
          ),
        )
      await write("aaa", 2, "newest")
      await write("mmm", 1, "middle")
      await write("zzz", 0, "oldest")

      const list = await new BackupManager(adapter, root).list()
      expect(list.map((e) => e.label)).toEqual(["newest", "middle", "oldest"])
    } finally {
      await fx.cleanup()
    }
  })

  it("缺少 seq 的旧 manifest 也能读，按 0 处理", async () => {
    const fx = await makeFixture()
    try {
      const adapter = new NodeAdapter()
      const root = join(fx.root, "backups")
      await adapter.writeFileAtomic(
        join(root, "legacy", "manifest.json"),
        new TextEncoder().encode(
          JSON.stringify({
            id: "legacy",
            label: "no seq field",
            createdAt: "2026-09-03T00:00:00.000Z",
            files: [],
            pristine: false,
          }),
        ),
      )
      const list = await new BackupManager(adapter, root).list()
      expect(list).toHaveLength(1)
      expect(list[0]!.seq).toBe(0)
    } finally {
      await fx.cleanup()
    }
  })

  it("list 在备份根目录不存在时返回空数组", async () => {
    const fx = await makeFixture()
    try {
      const mgr = new BackupManager(new NodeAdapter(), join(fx.root, "never-created"))
      expect(await mgr.list()).toEqual([])
    } finally {
      await fx.cleanup()
    }
  })
})
