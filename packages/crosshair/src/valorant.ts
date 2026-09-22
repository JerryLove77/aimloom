/**
 * VALORANT's public profile-code format, independently parsed from documented
 * field metadata in @valapi/crosshair (MIT, Copyright 2022 Ing Project), with
 * external examples from genesy/crosshair-codes (MIT, Copyright 2023 Gene Sy).
 * See docs/research/valorant-crosshair-sources.md and THIRD_PARTY_NOTICES.md.
 * This module reads strings only; it never contacts Riot or modifies a game.
 */
import { CrosshairError, type CrosshairWarning } from './errors';

export interface ValorantLine {
  enabled: boolean;
  opacity: number;
  length: number;
  verticalLength: number;
  independentVerticalLength: boolean;
  thickness: number;
  offset: number;
  movementError: boolean;
  firingError: boolean;
  movementMultiplier: number;
  firingMultiplier: number;
}

export interface ValorantProfile {
  color: number;
  customColor: string;
  useCustomColor: boolean;
  outlines: boolean;
  outlineThickness: number;
  outlineOpacity: number;
  centerDot: boolean;
  dotThickness: number;
  dotOpacity: number;
  fadeOnFire: boolean;
  overrideFiringError: boolean;
  showSpectated: boolean;
  inner: ValorantLine;
  outer: ValorantLine;
}

export interface ValorantSniper {
  color: number;
  customColor: string;
  useCustomColor: boolean;
  centerDot: boolean;
  dotThickness: number;
  dotOpacity: number;
}

export interface ValorantCrosshair {
  game: 'valorant';
  code: string;
  primary: ValorantProfile;
  /** Independent A settings; use global.usePrimaryForAds to select the effective ADS profile. */
  ads: ValorantProfile;
  sniper: ValorantSniper;
  global: { usePrimaryForAds: boolean; advanced: boolean; overrideSpectators: boolean };
  warnings: CrosshairWarning[];
}

type Section = '0' | 'P' | 'A' | 'S';

function defaultLine(outer: boolean): ValorantLine {
  return {
    enabled: true,
    opacity: outer ? 0.35 : 0.8,
    length: outer ? 2 : 6,
    verticalLength: outer ? 2 : 6,
    independentVerticalLength: false,
    thickness: 2,
    offset: outer ? 10 : 3,
    movementError: outer,
    firingError: true,
    movementMultiplier: 1,
    firingMultiplier: 1,
  };
}

function defaultProfile(): ValorantProfile {
  return {
    color: 0, customColor: 'FFFFFFFF', useCustomColor: false,
    outlines: true, outlineThickness: 1, outlineOpacity: 0.5,
    centerDot: false, dotThickness: 2, dotOpacity: 1,
    fadeOnFire: true, overrideFiringError: false, showSpectated: true,
    inner: defaultLine(false), outer: defaultLine(true),
  };
}

function readBoolean(value: string, field: string): boolean {
  if (value !== '0' && value !== '1') {
    throw new CrosshairError('INVALID_VALUE', `${field} 必须为 0 或 1。`, `${field} must be 0 or 1.`, field);
  }
  return value === '1';
}

function readNumber(value: string, field: string, max: number, min = 0, integer = true): number {
  const number = Number(value);
  if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(number)
    || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new CrosshairError('INVALID_VALUE', `${field} 必须为 ${min} 至 ${max} 的${integer ? '整数' : '数值'}。`,
      `${field} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`, field);
  }
  return number;
}

function readColor(value: string, field: string): string {
  if (!/^(?:[\dA-Fa-f]{6}|[\dA-Fa-f]{8})$/.test(value)) {
    throw new CrosshairError('INVALID_VALUE', `${field} 必须为 6 位 RGB 或 8 位 RGBA 十六进制颜色。`,
      `${field} must be a 6-digit RGB or 8-digit RGBA hex color.`, field);
  }
  return value.toUpperCase() + (value.length === 6 ? 'FF' : '');
}

function unsupported(field: string): never {
  throw new CrosshairError('UNSUPPORTED_FIELD', '准星代码包含暂不支持的字段。', 'The crosshair code has a field that is not supported yet.', field);
}

function applyLine(line: ValorantLine, key: string, value: string, field: string, outer: boolean): void {
  switch (key) {
    case 'b': line.enabled = readBoolean(value, field); break;
    case 'g': line.independentVerticalLength = readBoolean(value, field); break;
    case 'm': line.movementError = readBoolean(value, field); break;
    case 'f': line.firingError = readBoolean(value, field); break;
    case 'a': line.opacity = readNumber(value, field, 1, 0, false); break;
    case 'l': line.length = readNumber(value, field, outer ? 10 : 20); break;
    case 'v': line.verticalLength = readNumber(value, field, outer ? 10 : 20); break;
    case 't': line.thickness = readNumber(value, field, 10); break;
    case 'o': line.offset = readNumber(value, field, outer ? 40 : 20); break;
    case 's': line.movementMultiplier = readNumber(value, field, 3, 0, false); break;
    case 'e': line.firingMultiplier = readNumber(value, field, 3, 0, false); break;
    default: unsupported(field);
  }
}

function applyProfile(profile: ValorantProfile, key: string, value: string, field: string): void {
  if (key.length === 2 && (key[0] === '0' || key[0] === '1')) {
    const outer = key[0] === '1';
    applyLine(outer ? profile.outer : profile.inner, key.slice(1), value, field, outer);
    return;
  }
  switch (key) {
    case 'c': profile.color = readNumber(value, field, 8); break;
    case 'u': profile.customColor = readColor(value, field); break;
    case 'b': profile.useCustomColor = readBoolean(value, field); break;
    case 'h': profile.outlines = readBoolean(value, field); break;
    case 't': profile.outlineThickness = readNumber(value, field, 6, 1); break;
    case 'o': profile.outlineOpacity = readNumber(value, field, 1, 0, false); break;
    case 'd': profile.centerDot = readBoolean(value, field); break;
    case 'z': profile.dotThickness = readNumber(value, field, 6, 1); break;
    case 'a': profile.dotOpacity = readNumber(value, field, 1, 0, false); break;
    case 'f': profile.fadeOnFire = readBoolean(value, field); break;
    case 's': profile.showSpectated = readBoolean(value, field); break;
    case 'm': profile.overrideFiringError = readBoolean(value, field); break;
    default: unsupported(field);
  }
}

function applySniper(sniper: ValorantSniper, key: string, value: string, field: string): void {
  switch (key) {
    case 'c': sniper.color = readNumber(value, field, 8); break;
    case 't': sniper.customColor = readColor(value, field); break;
    case 'b': sniper.useCustomColor = readBoolean(value, field); break;
    case 'd': sniper.centerDot = readBoolean(value, field); break;
    case 's': sniper.dotThickness = readNumber(value, field, 4, 0, false); break;
    case 'o': sniper.dotOpacity = readNumber(value, field, 1, 0, false); break;
    default: unsupported(field);
  }
}

function isSection(value: string): value is 'P' | 'A' | 'S' {
  return value === 'P' || value === 'A' || value === 'S';
}

function selectCustomColor(profile: ValorantProfile | ValorantSniper, section: string, fields: Set<string>): void {
  if (profile.color === 8) {
    if (fields.has(`${section}.b`) && !profile.useCustomColor) {
      throw new CrosshairError('INVALID_VALUE', `${section}.c 为自定义颜色时，${section}.b 不能为 0。`,
        `${section}.b cannot be 0 when ${section}.c selects the custom color.`, `${section}.b`);
    }
    profile.useCustomColor = true;
  }
}

function hasDynamicLines(profile: ValorantProfile): boolean {
  return [profile.inner, profile.outer].some(line => line.enabled
    && line.thickness > 0 && (line.opacity > 0 || (profile.outlines && profile.outlineOpacity > 0))
    && (line.length > 0 || (line.independentVerticalLength && line.verticalLength > 0))
    && (line.movementError || line.firingError));
}

/**
 * Parse a complete profile, validating even inactive ADS/sniper sections.
 * Bounds and rejection of ambiguous inputs are Aimloom's policy, not Riot's
 * published decoder behavior. P is required; the bare default code "0" is not
 * accepted by this first version. No runtime object keys come from the input.
 */
export function parseValorant(input: string): ValorantCrosshair {
  if (typeof input !== 'string') {
    throw new CrosshairError('INVALID_CODE', '准星代码必须为文本。', 'The crosshair code must be text.');
  }
  if (input.length > 4096) {
    throw new CrosshairError('INPUT_TOO_LONG', '准星代码不能超过 4096 个字符。', 'The crosshair code cannot exceed 4096 characters.');
  }
  const code = input.trim();
  if (!code) throw new CrosshairError('EMPTY_INPUT', '请输入 VALORANT 准星代码。', 'Enter a VALORANT crosshair code.');
  const tokens = code.split(';');
  if (tokens.length > 512 || tokens.some(token => token.length === 0)) {
    throw new CrosshairError('INVALID_CODE', '准星代码包含空字段或过多字段。', 'The crosshair code has an empty field or too many fields.');
  }
  if (tokens[0] !== '0') {
    throw new CrosshairError('UNSUPPORTED_VERSION', '暂不支持此 VALORANT 准星代码版本。', 'This VALORANT crosshair code version is not supported yet.');
  }

  const primary = defaultProfile();
  const ads = defaultProfile();
  const sniper: ValorantSniper = {
    color: 7, customColor: 'FFFFFFFF', useCustomColor: false,
    centerDot: true, dotThickness: 1, dotOpacity: 0.75,
  };
  const global = { usePrimaryForAds: true, advanced: false, overrideSpectators: false };
  const sections = new Set<Section>();
  const fields = new Set<string>();
  let section: Section = '0';

  for (let index = 1; index < tokens.length;) {
    const key = tokens[index]!;
    if (isSection(key)) {
      if (sections.has(key)) {
        throw new CrosshairError('INVALID_CODE', `准星代码重复包含 ${key} 分区。`, `The crosshair code has the ${key} section more than once.`, key);
      }
      section = key;
      sections.add(key);
      index += 1;
      continue;
    }
    const field = `${section}.${key}`;
    const value = tokens[index + 1];
    if (value === undefined || isSection(value)) {
      throw new CrosshairError('INVALID_CODE', '准星代码包含缺少值的字段。', 'The crosshair code has a field with no value.', field);
    }
    if (fields.has(field)) {
      throw new CrosshairError('INVALID_CODE', `准星字段 ${field} 重复出现。`, `The crosshair field ${field} appears more than once.`, field);
    }
    fields.add(field);

    if (section === '0') {
      switch (key) {
        case 'p': global.usePrimaryForAds = readBoolean(value, field); break;
        case 's': global.advanced = readBoolean(value, field); break;
        case 'c': global.overrideSpectators = readBoolean(value, field); break;
        default: unsupported(field);
      }
    } else if (section === 'S') {
      applySniper(sniper, key, value, field);
    } else {
      applyProfile(section === 'P' ? primary : ads, key, value, field);
    }
    index += 2;
  }

  if (!sections.has('P')) {
    throw new CrosshairError('INVALID_CODE', '准星代码必须包含 P 主准星分区。', 'The crosshair code must include the P (primary) section.');
  }
  selectCustomColor(primary, 'P', fields);
  selectCustomColor(ads, 'A', fields);
  selectCustomColor(sniper, 'S', fields);

  const warnings: CrosshairWarning[] = [];
  if (hasDynamicLines(primary) || (!global.usePrimaryForAds && hasDynamicLines(ads))) {
    warnings.push({ code: 'VALORANT_DYNAMIC_STATIC', message: '准星启用了移动或开火误差；生成结果为静态图像，不能还原游戏中的动态变化。' });
  }
  if (sections.has('S')) {
    warnings.push({ code: 'VALORANT_SNIPER_NOT_RENDERED', message: '已读取并校验狙击镜设置；本版本暂不渲染狙击镜准星。' });
  }
  if (sections.has('A') && global.usePrimaryForAds) {
    warnings.push({ code: 'VALORANT_ADS_USES_PRIMARY', message: '已保留独立 ADS 设置；当前代码启用复制主准星，ADS 预览将使用主准星。' });
  } else if (!sections.has('A') && !global.usePrimaryForAds) {
    warnings.push({ code: 'VALORANT_ADS_DEFAULT', message: '当前代码关闭 ADS 复制且未提供 A 分区；ADS 将使用默认设置。' });
  }
  return { game: 'valorant', code, primary, ads, sniper, global, warnings };
}
