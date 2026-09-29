import type { Vec3 } from "../types.js"
import { validateScheme } from "./document.js"
import { SURFACE_SLOTS, type SchemeDocument } from "./types.js"

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!)
const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0")
const color = (value: Vec3) => `#${hex(value.x * 255)}${hex(value.y * 255)}${hex(value.z * 255)}`
const short = (value: string, limit = 36) => [...value].slice(0, limit).join("") + ([...value].length > limit ? "…" : "")

/** Every fixed string the preview draws, in both languages. */
const STRINGS = {
  zh: {
    slot: { wall: "墙面", floor: "地面", ceiling: "天花板", ramp: "斜坡" },
    roughness: "粗糙",
    metallic: "金属",
    emissive: "自发光",
    scale: "缩放",
    titleSuffix: "— theme 近似预览",
    desc: "背景颜色与布局示意。材质贴图、金属、粗糙度、自发光、缩放、天空预设与游戏光照未模拟。不会修改游戏文件。",
    eyebrow: "THEME · 环境配色示意",
    skySolid: "纯色天空",
    skyPreset: (id: number) => `天空预设 ${id} · 示意占位`,
    approxNote: "近似预览 · 不代表游戏内最终效果",
    unsimulated: "贴图、材质属性、天空预设、云层和光照未模拟；数值见上方。此图不预览敌人、准星或训练规则。",
    warnings: (count: number) => `源文件兼容提示 ${count} 项；详情见 scheme.warnings。`,
    noWrite: "本地预览 · 不写入游戏文件",
  },
  en: {
    slot: { wall: "Wall", floor: "Floor", ceiling: "Ceiling", ramp: "Ramp" },
    roughness: "Roughness",
    metallic: "Metal",
    emissive: "Emissive",
    scale: "Scale",
    titleSuffix: "— theme preview (approximate)",
    desc: "An approximate background color and layout. Material textures, metal, roughness, emissive, scale, sky preset and in-game lighting are not simulated. No game file is changed.",
    eyebrow: "THEME · APPROXIMATE COLORS",
    skySolid: "Solid sky",
    skyPreset: (id: number) => `Sky preset ${id} · placeholder`,
    approxNote: "Approximate preview · not the final in-game look",
    unsimulated: "Textures, material properties, sky preset, clouds and lighting are not simulated; see the values above. This image does not preview the enemy, crosshair or training rules.",
    warnings: (count: number) => `${count} source-compatibility note(s); see scheme.warnings.`,
    noWrite: "Local preview · writes no game file",
  },
} as const

/** Self-contained schematic: no network, material shader simulation, or gameplay geometry. */
export function renderSchemePreview(input: SchemeDocument, lang: "zh" | "en" = "zh"): string {
  const doc = validateScheme(input)
  const env = doc.environment
  const s = STRINGS[lang]
  const sky = env.sky.solid ? `#${hex(env.sky.color.r)}${hex(env.sky.color.g)}${hex(env.sky.color.b)}` : "#879aad"
  const cards = SURFACE_SLOTS.map((slot, index) => {
    const surface = env[slot]
    const x = 32 + index * 272
    return `<g transform="translate(${x} 532)"><rect width="256" height="113" rx="8" fill="#202630"/><rect x="16" y="16" width="20" height="20" rx="4" fill="${color(surface.tint)}"/><text x="46" y="32" font-size="15" fill="#f2f4f7">${s.slot[slot]}</text><text x="16" y="60" font-size="12" fill="#c2ccd8">${escape(short(surface.material, 27))}</text><text x="16" y="82" font-size="11" fill="#a5b1c1">${s.roughness} ${surface.roughness.toFixed(2)} · ${s.metallic} ${surface.metallic.toFixed(2)}</text><text x="16" y="100" font-size="11" fill="#a5b1c1">${s.emissive} ${surface.fullBright.toFixed(2)} · ${s.scale} ${escape(short(String(surface.textureScale), 10))}</text></g>`
  }).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1152" height="768" viewBox="0 0 1152 768" role="img" aria-labelledby="scheme-title scheme-description">
<title id="scheme-title">${escape(doc.name)} ${s.titleSuffix}</title>
<desc id="scheme-description">${s.desc}</desc>
<rect width="1152" height="768" fill="#15191f"/>
<g font-family="system-ui, sans-serif"><text x="32" y="44" fill="#eaf0f7" font-size="25" font-weight="600">${escape(short(doc.name, 60))}</text><text x="32" y="72" fill="#a5b1c1" font-size="13">${s.eyebrow}</text>
<svg x="32" y="96" width="1088" height="408" viewBox="0 0 1088 408"><rect width="1088" height="408" fill="${sky}"/>
<path d="M0 0H1088L860 94H228Z" fill="${color(env.ceiling.tint)}"/>
<path d="M0 0L228 94V285L0 408Z" fill="${color(env.wall.tint)}"/>
<path d="M1088 0L860 94V285L1088 408Z" fill="${color(env.wall.tint)}"/>
<path d="M0 408L228 285H860L1088 408Z" fill="${color(env.floor.tint)}"/>
<path d="M690 358L790 233L890 266L845 392Z" fill="${color(env.ramp.tint)}" stroke="#ffffff" stroke-opacity=".15"/>
<path d="M0 0L228 94H860L1088 0M0 408L228 285H860L1088 408" fill="none" stroke="#ffffff" stroke-opacity=".15"/>
<text x="544" y="186" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke" font-size="14">${env.sky.solid ? s.skySolid : s.skyPreset(env.sky.presetId)}</text>
</svg>${cards}
<text x="32" y="682" fill="#edcf8e" font-size="14">${s.approxNote}</text>
<text x="32" y="706" fill="#a5b1c1" font-size="12">${s.unsimulated}</text>
<text x="32" y="732" fill="#a5b1c1" font-size="12">${doc.warnings.length ? s.warnings(doc.warnings.length) : s.noWrite}</text></g></svg>`
}
