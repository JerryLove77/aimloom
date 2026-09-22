import { LocalizedError, type EnemyAppearance, type Vec3 } from "../types.js"
import { parseEnemyColor, resolveEnemyAppearance, type EnemySelection } from "./model.js"

export type EnemyPreviewState = "normal" | "hit" | "look-at"
export type EnemyPreview = {
  state: EnemyPreviewState
  head: { color: Vec3 | null; glow: number | null }
  body: { color: Vec3 | null; glow: number | null }
  material: { roughness: number | null; metallic: number | null; fullBright: number | null }
  warnings: string[]
}

/** Every fixed string the preview draws or warns with, in both languages. */
const STRINGS = {
  zh: {
    stateLabel: { normal: "普通", hit: "命中", "look-at": "瞄准" } as Record<EnemyPreviewState, string>,
    defaultTitle: "Enemy 外观预览",
    subtitle: "独立外观预览 · 不修改游戏文件",
    unknownColor: "? 场景颜色未知",
    colorSample: "头部 / 身体颜色示意",
    desc: "普通、命中和瞄准状态的近似预览。圆形仅为色样，不表示游戏模型、尺寸或命中框。",
    approxNote: "材质与光照为近似效果；场景覆盖和真实游戏效果待验证。",
    shapeNote: "圆形是头部 / 身体色样，不代表模型、目标尺寸或命中框。命中与瞄准状态分别展示。",
    baseWarning: "外观示意：材质、光照及反馈优先级以游戏实际显示为准。",
    part: { head: "头部", body: "身体" } as Record<"head" | "body", string>,
    partUnknown: (part: string) => `${part}由场景决定或当前设置不完整，无法确定颜色。`,
  },
  en: {
    stateLabel: { normal: "Normal", hit: "Hit", "look-at": "Look at" } as Record<EnemyPreviewState, string>,
    defaultTitle: "Enemy look preview",
    subtitle: "Standalone look preview · no game file is changed",
    unknownColor: "? scene color unknown",
    colorSample: "Head / body color sample",
    desc: "Approximate preview of the normal, hit and look-at states. The circles are color samples only; they do not represent the in-game model, size or hitbox.",
    approxNote: "Material and lighting are approximate; scene overrides and the real in-game look are still unverified.",
    shapeNote: "The circles are head / body color samples, not the model, target size or hitbox. Hit and look-at states are shown separately.",
    baseWarning: "Approximate look: material, lighting and feedback priority follow the game's actual display.",
    part: { head: "Head", body: "Body" } as Record<"head" | "body", string>,
    partUnknown: (part: string) => `${part} is set by the scene or the current setup is incomplete, so its color can't be determined.`,
  },
} as const

export function createEnemyPreview(
  current: Partial<EnemyAppearance>, selection: EnemySelection | null, state: EnemyPreviewState, lang: "zh" | "en" = "zh",
): EnemyPreview {
  if (!["normal", "hit", "look-at"].includes(state)) throw new LocalizedError("不支持的 enemy 预览状态", "Unsupported enemy preview state")
  const s = STRINGS[lang]
  const e = resolveEnemyAppearance(current, selection)
  const warnings: string[] = [s.baseWarning]
  const enabled = state === "hit" ? e.changeOnHit : state === "look-at" ? e.changeOnLookAt : false
  const suffix = enabled ? (state === "hit" ? "OnHit" : "OnLookAt") : ""
  const part = (name: "head" | "body") => {
    const override = name === "head" ? e.overrideHead : e.overrideBody
    const color = e[`${name}Color${suffix}`]
    const glow = e[`glowUp${name === "head" ? "Head" : "Body"}${suffix}`]
    if (override !== true || color === undefined || enabled === undefined) {
      warnings.push(s.partUnknown(s.part[name]))
      return { color: null, glow: null }
    }
    return { color, glow: glow ?? null }
  }
  return { state, head: part("head"), body: part("body"), material: { roughness: e.roughness ?? null, metallic: e.metallic ?? null, fullBright: e.fullBright ?? null }, warnings }
}

export function enemyColorToHex(color: Vec3): string {
  const c = parseEnemyColor(color)
  return "#" + [c.x, c.y, c.z].map((n) => Math.round(n * 255).toString(16).padStart(2, "0")).join("")
}
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!)

/** Standalone approximate color/material swatch, not a scenario/geometry or Unreal renderer. */
export function renderEnemySvg(
  current: Partial<EnemyAppearance>, selection: EnemySelection | null,
  options: { title?: string; background?: string; floor?: string } = {}, lang: "zh" | "en" = "zh",
): string {
  const s = STRINGS[lang]
  const background = enemyColorToHex(parseEnemyColor(options.background ?? "#20232c"))
  const floor = enemyColorToHex(parseEnemyColor(options.floor ?? "#303641"))
  const rawTitle = options.title ?? s.defaultTitle
  const title = escape(rawTitle)
  const displayTitle = escape(Array.from(rawTitle).length > 34 ? Array.from(rawTitle).slice(0, 33).join("") + "…" : rawTitle)
  const states: EnemyPreviewState[] = ["normal", "hit", "look-at"]
  const panels = states.map((state, i) => {
    const p = createEnemyPreview(current, selection, state, lang)
    const draw = (part: EnemyPreview["head"], cx: number, cy: number, r: number, id: string) => {
      if (!part.color) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#unknown)" stroke="#a9a9b2"/><text x="${cx}" y="${cy + 6}" text-anchor="middle" fill="#ffffff" font-size="20">?</text>`
      const color = enemyColorToHex(part.color)
      const shine = (1 - (p.material.roughness ?? 1)) * (0.18 + (p.material.metallic ?? 0) * 0.5) * (1 - (p.material.fullBright ?? 0))
      const shade = 0.45 * (1 - (p.material.fullBright ?? 0))
      const glow = Math.min(part.glow ?? 0, 4) / 4 * 0.25
      return `<defs><radialGradient id="${id}"><stop stop-color="#ffffff" stop-opacity="${shine}"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${shade}"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="${color}" opacity="${glow}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`
    }
    return `<g transform="translate(${24 + i * 292},88)"><rect width="276" height="320" rx="12" fill="${background}"/><path d="M0 224H276V308Q276 320 264 320H12Q0 320 0 308Z" fill="${floor}"/><text x="20" y="32" fill="#ffffff" font-size="17">${s.stateLabel[state]}</text>${draw(p.head, 138, 98, 27, `head-${i}`)}${draw(p.body, 138, 189, 52, `body-${i}`)}<text x="138" y="286" text-anchor="middle" fill="#ffffff" font-size="12">${!p.head.color || !p.body.color ? s.unknownColor : s.colorSample}</text></g>`
  }).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="908" height="492" viewBox="0 0 908 492" role="img" aria-label="${title}"><title>${title}</title><desc>${s.desc}</desc><defs><pattern id="unknown" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#44444c"/><path d="M0 12L12 0" stroke="#777780"/></pattern></defs><rect width="908" height="492" rx="16" fill="#0d0d10"/><g font-family="Microsoft YaHei, PingFang SC, sans-serif"><text x="24" y="43" fill="#f4f4f5" font-size="23">${displayTitle}</text><text x="24" y="67" fill="#a9a9b2" font-size="12">${s.subtitle}</text>${panels}<text x="24" y="440" fill="#e8c36a" font-size="13">${s.approxNote}</text><text x="24" y="467" fill="#a9a9b2" font-size="12">${s.shapeNote}</text></g></svg>\n`
}
