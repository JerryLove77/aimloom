import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { applyPatch, parseSettings, readKey, serializeSettings } from "../src/settings/settings-doc.js"
import { makeFixture } from "./helpers/fixture.js"

async function realDoc() {
  const fx = await makeFixture()
  const bytes = new Uint8Array(await readFile(fx.settingsPath))
  await fx.cleanup()
  return parseSettings(bytes)
}

/**
 * The corpus at PACK_SOURCE is the real one in the private repository and a neutral
 * synthetic one in the public export (scripts/public/sample-corpus); their values differ
 * (see CLAUDE.md's Privacy section and the public-mirror plan). Read the expected value
 * straight from the fixture's own JSON instead of hard-coding it, so the same assertion
 * passes against either corpus.
 */
async function expectedRawSettings(): Promise<any> {
  const fx = await makeFixture()
  const text = await readFile(fx.settingsPath, "utf-8")
  await fx.cleanup()
  return JSON.parse(text)
}

describe("parseSettings", () => {
  it("读出六个 section 与顶层杂项键", async () => {
    const doc = await realDoc()
    for (const s of [
      "booleanSettings",
      "integerSettings",
      "floatSettings",
      "stringSettings",
      "vectorSettings",
      "colorSettings",
    ]) {
      expect(doc.raw[s]).toBeTypeOf("object")
    }
    expect(doc.raw.version).toBe(1)
    expect(doc.raw.currentlySelectedBoundingBoxType).toBe("Cuboid")
  })

  it("readKey 取到已知值", async () => {
    const doc = await realDoc()
    const expected = await expectedRawSettings()
    expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe(
      expected.stringSettings["EStringSettingId::CurrentThemeName"],
    )
    expect(readKey(doc, "floatSettings", "EFloatSettingId::XSens")).toBe(
      expected.floatSettings["EFloatSettingId::XSens"],
    )
    expect(readKey(doc, "integerSettings", "EIntegerSettingId::DPI")).toBe(
      expected.integerSettings["EIntegerSettingId::DPI"],
    )
  })

  it("readKey 对不存在的键返回 undefined", async () => {
    const doc = await realDoc()
    expect(readKey(doc, "stringSettings", "EStringSettingId::NoSuchKey")).toBeUndefined()
  })
})

describe("applyPatch", () => {
  it("写入指定键", async () => {
    const doc = await realDoc()
    const next = applyPatch(doc, { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } })
    expect(readKey(next, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe("3 AM")
  })

  it("不修改原 doc（纯函数）", async () => {
    const doc = await realDoc()
    applyPatch(doc, { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } })
    expect(readKey(doc, "stringSettings", "EStringSettingId::CurrentThemeName")).toBe("clover-alternate")
  })

  it("patch 之外的所有键值保持不变", async () => {
    const doc = await realDoc()
    const next = applyPatch(doc, { stringSettings: { "EStringSettingId::CurrentThemeName": "3 AM" } })

    const before = JSON.parse(JSON.stringify(doc.raw))
    const after = JSON.parse(JSON.stringify(next.raw))
    before.stringSettings["EStringSettingId::CurrentThemeName"] = "3 AM"
    expect(after).toEqual(before)
  })

  it("顶层非 section 键（version、characterModelOverride）原样保留", async () => {
    const doc = await realDoc()
    const next = applyPatch(doc, { floatSettings: { "EFloatSettingId::HitVolume": 0.5 } })
    expect(next.raw.version).toEqual(doc.raw.version)
    expect(next.raw.characterModelOverride).toEqual(doc.raw.characterModelOverride)
    expect(next.raw.currentlySelectedBoundingBoxType).toEqual(doc.raw.currentlySelectedBoundingBoxType)
  })
})

describe("serializeSettings", () => {
  it("序列化后可被重新解析，且值完全一致（浮点按值比较，不比字符串）", async () => {
    const doc = await realDoc()
    const round = parseSettings(serializeSettings(doc))
    expect(round.raw).toEqual(doc.raw)
  })

  it("输出以 tab 缩进且以换行结尾", async () => {
    const doc = await realDoc()
    const text = new TextDecoder().decode(serializeSettings(doc))
    expect(text.includes("\n\t")).toBe(true)
    expect(text.endsWith("\n")).toBe(true)
  })

  it("多轮往返稳定（第二轮输出与第一轮逐字节相同）", async () => {
    const doc = await realDoc()
    const once = serializeSettings(doc)
    const twice = serializeSettings(parseSettings(once))
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true)
  })

  it("浮点精度不丢失：往返后仍是同一个 double", async () => {
    const doc = await realDoc()
    const round = parseSettings(serializeSettings(doc))
    // 语料中这个值有 17 位有效数字，最短往返表示与原文本不同但数值相同
    expect(readKey(round, "floatSettings", "EFloatSettingId::EnemyMetalic")).toBe(
      readKey(doc, "floatSettings", "EFloatSettingId::EnemyMetalic"),
    )
    expect(readKey(round, "floatSettings", "EFloatSettingId::Gamma")).toBe(
      readKey(doc, "floatSettings", "EFloatSettingId::Gamma"),
    )
  })
})
