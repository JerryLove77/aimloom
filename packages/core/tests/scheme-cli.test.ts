import { afterEach, describe, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const exec = promisify(execFile)
const root = fileURLToPath(new URL("../../../", import.meta.url))
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "scheme-cli-")); dirs.push(dir)
  const source = join(dir, "source.json")
  await writeFile(source, JSON.stringify({ themeName: "CLI scene", wallMaterial: "DRYWALL", floorMaterial: "DRYWALL", enemyBodyColor: { x: 0, y: 0, z: 0 } }))
  return { dir, source }
}
const run = (...args: string[]) => exec(process.execPath, ["--import", "tsx", "packages/core/cli/scheme.ts", ...args], { cwd: root })

describe("scheme development CLI", () => {
  it("exports preview, editable document and composed native theme without changing source", async () => {
    const { dir, source } = await fixture()
    const before = await readFile(source)
    const svg = join(dir, "preview.svg"), saved = join(dir, "scheme.json"), theme = join(dir, "theme.json")
    const result = await run("--input", source, "--preview", svg, "--save", saved, "--base-theme", source, "--export-theme", theme)
    expect(JSON.parse(result.stdout)).toHaveProperty("nativeApplicationPerformed", false)
    expect(await readFile(svg, "utf8")).toContain("近似预览")
    expect(JSON.parse(await readFile(saved, "utf8"))).toHaveProperty("schemaVersion", 1)
    expect(JSON.parse(await readFile(theme, "utf8"))).toHaveProperty("enemyBodyColor", { x: 0, y: 0, z: 0 })
    expect(await readFile(source)).toEqual(before)
  })

  it("refuses an existing destination before writing any output", async () => {
    const { dir, source } = await fixture()
    const before = await readFile(source)
    await expect(run("--input", source, "--preview", join(dir, "preview.svg"), "--save", source)).rejects.toMatchObject({ stderr: expect.stringContaining("输出已存在") })
    expect(await readdir(dir)).toEqual(["source.json"])
    expect(await readFile(source)).toEqual(before)
  })

  it("rejects incomplete or ambiguous exports before writing", async () => {
    const { dir, source } = await fixture()
    await expect(run("--input", source, "--export-theme", join(dir, "theme.json"))).rejects.toMatchObject({ stderr: expect.stringContaining("必须同时提供") })
    await expect(run("--input", source, "--save", join(dir, "out"), "--preview", join(dir, "out"))).rejects.toMatchObject({ stderr: expect.stringContaining("输出路径不能重复") })
    expect(await readdir(dir)).toEqual(["source.json"])
  })

  it("exports review blockers while preserving unrelated settings in the candidate", async () => {
    const { dir, source } = await fixture()
    const settings = join(dir, "settings.json"), review = join(dir, "review.json")
    const original = JSON.stringify({ floatSettings: { "EFloatSettingId::FOV": 103 }, vectorSettings: { "EVectorSettingId::EnemyBodyColor": { x: 0, y: 0, z: 0 } } })
    await writeFile(settings, original)
    await run("--input", source, "--settings", settings, "--review", review)
    const output = JSON.parse(await readFile(review, "utf8"))
    expect(output.blockers.some((b: { code: string }) => b.code === "material-binding-unverified")).toBe(true)
    expect(output.next.raw.floatSettings["EFloatSettingId::FOV"]).toBe(103)
    expect(output.next.raw.vectorSettings["EVectorSettingId::EnemyBodyColor"]).toEqual({ x: 0, y: 0, z: 0 })
    expect(await readFile(settings, "utf8")).toBe(original)
  })

  it("validates later inputs before creating the first output", async () => {
    const { dir, source } = await fixture()
    const invalid = join(dir, "invalid.json")
    await writeFile(invalid, "not JSON")
    await expect(run("--input", source, "--preview", join(dir, "preview.svg"), "--base-theme", invalid, "--export-theme", join(dir, "theme.json"))).rejects.toMatchObject({ stderr: expect.stringContaining("基础主题无效") })
    expect((await readdir(dir)).sort()).toEqual(["invalid.json", "source.json"])
  })

  it("removes its earlier outputs when a later output cannot be created", async () => {
    const { dir, source } = await fixture()
    await expect(run("--input", source, "--preview", join(dir, "preview.svg"), "--save", join(dir, "missing-parent", "scheme.json"))).rejects.toMatchObject({ stderr: expect.stringContaining("ENOENT") })
    expect(await readdir(dir)).toEqual(["source.json"])
  })
})
