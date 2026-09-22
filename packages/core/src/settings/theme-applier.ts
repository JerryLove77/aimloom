import type { SettingsPatch, Surface, Theme } from "../types.js"
import { B, C, F, I, S, V } from "./keys.js"

/**
 * Theme → PrimaryUserSettings 映射（spec §5.2）。
 *
 * 逐条显式书写，不使用命名规则推导——游戏侧命名不一致，
 * 已知四类不规则：Tint→Color、丢 Color、拼写错误 Metalic、完全换名。
 */
export function themeToPatch(theme: Theme): SettingsPatch {
  const strings: Record<string, string> = {
    [S("CurrentThemeName")]: theme.name,
    [S("WallMaterial")]: theme.wall.material,
    [S("FloorMaterial")]: theme.floor.material,
    [S("CeilingMaterial")]: theme.ceiling.material,
    [S("RampMaterial")]: theme.ramp.material,
  }

  const floats: Record<string, number> = {}
  const vectors: Record<string, { x: number; y: number; z: number }> = {}

  // 四个表面同构：Roughness / Metallic / FullBright / TextureScale 直译，Tint → Color
  const surfaces: [string, Surface][] = [
    ["Wall", theme.wall],
    ["Floor", theme.floor],
    ["Ceiling", theme.ceiling],
    ["Ramp", theme.ramp],
  ]
  for (const [name, s] of surfaces) {
    floats[F(`${name}Roughness`)] = s.roughness
    floats[F(`${name}Metallic`)] = s.metallic
    floats[F(`${name}FullBright`)] = s.fullBright
    floats[F(`${name}TextureScale`)] = s.textureScale
    vectors[V(`${name}Color`)] = s.tint // Tint → Color
  }

  const e = theme.enemy
  floats[F("EnemyRoughness")] = e.roughness // enemyColorRoughness → EnemyRoughness（丢 Color）
  floats[F("EnemyMetalic")] = e.metallic //   enemyColorMetallic  → EnemyMetalic（拼写错误）
  floats[F("EnemyFullBright")] = e.fullBright // enemyColorFullBright → EnemyFullBright（丢 Color）
  floats[F("EnemyGlowUpHead")] = e.glowUpHead
  floats[F("EnemyGlowUpBody")] = e.glowUpBody
  floats[F("EnemyGlowUpHeadOnHit")] = e.glowUpHeadOnHit
  floats[F("EnemyGlowUpBodyOnHit")] = e.glowUpBodyOnHit
  floats[F("EnemyGlowUpHeadOnLookAt")] = e.glowUpHeadOnLookAt
  floats[F("EnemyGlowUpBodyOnLookAt")] = e.glowUpBodyOnLookAt
  floats[F("TeamGlowUpHead")] = theme.team.glowUpHead
  floats[F("TeamGlowUpBody")] = theme.team.glowUpBody

  vectors[V("EnemyHeadColor")] = e.headColor
  vectors[V("EnemyBodyColor")] = e.bodyColor
  vectors[V("EnemyHeadColorOnHit")] = e.headColorOnHit
  vectors[V("EnemyBodyColorOnHit")] = e.bodyColorOnHit
  vectors[V("EnemyHeadColorOnLookAt")] = e.headColorOnLookAt
  vectors[V("EnemyBodyColorOnLookAt")] = e.bodyColorOnLookAt

  return {
    stringSettings: strings,
    floatSettings: floats,
    vectorSettings: vectors,
    integerSettings: {
      [I("SkyPreset")]: theme.sky.presetId, //   skyPresetId  → SkyPreset（去 Id）
      [I("CloudCover")]: theme.sky.cloudCoverId, // cloudCoverId → CloudCover（去 Id）
    },
    booleanSettings: {
      [B("OverrideEnemyHeadColor")]: e.overrideHead,
      [B("OverrideEnemyBodyColor")]: e.overrideBody,
      [B("ChangeEnemyColorOnHit")]: e.changeOnHit,
      [B("ChangeEnemyColorOnLookAt")]: e.changeOnLookAt,
      // setEnemyBodyColorAsAttackColor → EnemyAttacksColoredByBody（完全换名，spec §10.2 待真机确认）
      [B("EnemyAttacksColoredByBody")]: e.bodyColorAsAttackColor,
      [B("SolidSkyColor")]: theme.sky.solid,
      [B("ShowSunInSkybox")]: theme.sky.sunVisible, // sunVisible → ShowSunInSkybox（完全换名）
    },
    colorSettings: {
      [C("SkyColor")]: theme.sky.color,
    },
  }
}
