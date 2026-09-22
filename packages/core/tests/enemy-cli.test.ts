import { afterEach, expect, it } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const exec = promisify(execFile)
const cli = fileURLToPath(new URL("../cli/enemy.ts", import.meta.url))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kvk-enemy-")); roots.push(root)
  const settings = join(root, "PrimaryUserSettings.json")
  const enemy = join(root, "enemy.json")
  const bytes = '{"version":1,"vectorSettings":{"EVectorSettingId::EnemyBodyColor":{"x":0,"y":0,"z":0}},"stringSettings":{"other":"2026-09-15T00:00:00Z"}}\n'
  await writeFile(settings, bytes)
  await writeFile(enemy, JSON.stringify({ schemaVersion: 1, kind: "enemy-appearance", name: "蓝色", appearance: { bodyColor: "#0080ff" }, source: { kind: "generated", provider: "test" } }))
  return { root, settings, enemy, bytes }
}
it("prepares a source-bound enemy request without touching settings or including generator metadata", async () => {
  const fx = await fixture(); const output = join(fx.root, "request.json")
  await exec(process.execPath, ["--import", "tsx", cli, "prepare", fx.settings, fx.enemy, output])
  const request = JSON.parse(await readFile(output, "utf8"))
  expect(request).toEqual({ schemaVersion: 1, kind: "enemy-settings-patch", name: "蓝色",
    sourceSettingsSha256: createHash("sha256").update(fx.bytes).digest("hex"),
    patch: { vectorSettings: { "EVectorSettingId::EnemyBodyColor": { x: 0, y: 128/255, z: 1 } } } })
  expect(await readFile(fx.settings, "utf8")).toBe(fx.bytes)
  await expect(exec(process.execPath, ["--import", "tsx", cli, "prepare", fx.settings, fx.enemy, output])).rejects.toThrow()
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(request)
})
it("renders a preview even when current native fields are missing, and refuses input overwrite", async () => {
  const fx = await fixture(); const output = join(fx.root, "preview.svg")
  await exec(process.execPath, ["--import", "tsx", cli, "preview", fx.settings, fx.enemy, output])
  expect(await readFile(output, "utf8")).toContain("场景颜色未知")
  await expect(exec(process.execPath, ["--import", "tsx", cli, "preview", fx.settings, fx.enemy, fx.settings])).rejects.toThrow()
  expect(await readFile(fx.settings, "utf8")).toBe(fx.bytes)
})
