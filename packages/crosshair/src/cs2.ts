/**
 * Share-code field layout adapted from AkiVer's MIT-licensed csgo-sharecode v5.0.0.
 * https://github.com/akiver/csgo-sharecode/blob/753f16fe97f9bbb121fb56675b40f035ad403d05/src/index.ts
 * Copyright (c) 2017-present AkiVer. See THIRD_PARTY_NOTICES.md for the full license.
 * This community format reference does not establish exact CS2 rendering behavior.
 */
import { CrosshairError, type CrosshairWarning } from './errors';

const ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const CODE_PATTERN = new RegExp(`^CSGO(?:-[${ALPHABET}]{5}){5}$`);
const PAYLOAD_LIMIT = 1n << 144n;

export interface Cs2Settings {
  length: number;
  red: number;
  green: number;
  blue: number;
  gap: number;
  alphaEnabled: boolean;
  alpha: number;
  outlineEnabled: boolean;
  outline: number;
  color: number;
  thickness: number;
  centerDotEnabled: boolean;
  splitDistance: number;
  followRecoil: boolean;
  fixedCrosshairGap: number;
  innerSplitAlpha: number;
  outerSplitAlpha: number;
  splitSizeRatio: number;
  tStyleEnabled: boolean;
  deployedWeaponGapEnabled: boolean;
  style: number;
}

export interface Cs2Crosshair {
  game: 'cs2';
  code: string;
  settings: Cs2Settings;
  warnings: CrosshairWarning[];
}

export function parseCs2(input: string): Cs2Crosshair {
  if (typeof input !== 'string') {
    throw new CrosshairError('INVALID_CODE', 'CS2 准星代码必须是文本。', 'The CS2 crosshair code must be text.');
  }
  if (input.length > 4096) {
    throw new CrosshairError('INPUT_TOO_LONG', '准星代码不能超过 4096 个字符。', 'The crosshair code cannot exceed 4096 characters.');
  }
  const code = input.trim();
  if (!code) {
    throw new CrosshairError('EMPTY_INPUT', '请输入 CS2 准星分享代码。', 'Enter a CS2 crosshair share code.');
  }
  if (!CODE_PATTERN.test(code)) {
    throw new CrosshairError('INVALID_CODE', '请输入以 CSGO- 开头、包含五组合法字符的准星代码，每组五个字符，注意区分大小写。', 'Enter a code that starts with CSGO- and has five groups of five valid, case-sensitive characters.');
  }

  const payload = code.slice(5).replaceAll('-', '');
  let value = 0n;
  for (let index = payload.length - 1; index >= 0; index--) {
    value = value * 57n + BigInt(ALPHABET.indexOf(payload[index]!));
  }
  if (value >= PAYLOAD_LIMIT) {
    throw new CrosshairError('INVALID_CODE', 'CS2 准星代码的数据长度超过 18 字节。', "The CS2 crosshair code's data is longer than 18 bytes.");
  }

  const bytes = new Uint8Array(18);
  for (let index = bytes.length - 1; index >= 0; index--) {
    bytes[index] = Number(value & 255n);
    value >>= 8n;
  }
  const checksum = bytes.slice(1).reduce((sum, byte) => sum + byte, 0) % 256;
  if (bytes[0] !== checksum) {
    throw new CrosshairError('INVALID_CODE', 'CS2 准星代码校验失败，代码可能已损坏，或是比赛录像分享代码。', 'The CS2 crosshair code failed its checksum; it may be corrupted, or a match-replay share code.');
  }
  if (bytes[1] !== 1) {
    throw new CrosshairError('UNSUPPORTED_VERSION', '目前仅支持版本 1 的 CS2 准星代码格式。', 'Only version 1 of the CS2 crosshair code format is supported.', 'version');
  }

  // The version-1 reference and all published fixtures leave these positions zero.
  // Reject possible extensions instead of silently losing unrecognized settings.
  if ((bytes[8]! & 0x78) !== 0 || (bytes[13]! & 1) !== 0) {
    throw new CrosshairError('UNSUPPORTED_FIELD', '此 CS2 准星代码包含尚未支持的标记。', 'This CS2 crosshair code has a flag that is not supported yet.', 'reservedBits');
  }
  if (bytes.slice(15).some((byte) => byte !== 0)) {
    throw new CrosshairError('UNSUPPORTED_FIELD', '此 CS2 准星代码包含尚未支持的扩展数据。', 'This CS2 crosshair code has extension data that is not supported yet.', 'reservedBytes');
  }

  const color = bytes[10]! & 7;
  const style = (bytes[13]! & 0x0f) >> 1;
  if (color > 5) {
    throw new CrosshairError('UNSUPPORTED_FIELD', `暂不支持 CS2 颜色预设 ${color}。`, `CS2 color preset ${color} is not supported yet.`, 'color');
  }
  if (style > 5) {
    throw new CrosshairError('UNSUPPORTED_FIELD', `暂不支持 CS2 准星样式 ${style}。`, `CS2 crosshair style ${style} is not supported yet.`, 'style');
  }

  const settings: Cs2Settings = {
    gap: ((bytes[2]! << 24) >> 24) / 10,
    outline: bytes[3]! / 2,
    red: bytes[4]!,
    green: bytes[5]!,
    blue: bytes[6]!,
    alpha: bytes[7]!,
    splitDistance: bytes[8]! & 7,
    followRecoil: (bytes[8]! & 0x80) !== 0,
    fixedCrosshairGap: ((bytes[9]! << 24) >> 24) / 10,
    color,
    outlineEnabled: (bytes[10]! & 8) !== 0,
    innerSplitAlpha: (bytes[10]! >> 4) / 10,
    outerSplitAlpha: (bytes[11]! & 0x0f) / 10,
    splitSizeRatio: (bytes[11]! >> 4) / 10,
    thickness: bytes[12]! / 10,
    centerDotEnabled: (bytes[13]! & 0x10) !== 0,
    deployedWeaponGapEnabled: (bytes[13]! & 0x20) !== 0,
    alphaEnabled: (bytes[13]! & 0x40) !== 0,
    tStyleEnabled: (bytes[13]! & 0x80) !== 0,
    style,
    length: bytes[14]! / 10,
  };

  const warnings: CrosshairWarning[] = [];
  if (style === 0 || style === 1 || style === 3) {
    warnings.push({
      code: 'CS2_DISABLED_STYLE',
      message: `样式 ${style} 是 CS2 已停用的旧版样式，静态图片无法还原其原有游戏行为。`,
    });
  }
  if (style === 2 || style === 5) {
    warnings.push({
      code: 'CS2_DYNAMIC_STYLE',
      message: '此准星使用动态样式，静态图片不包含移动、开火和线条分裂效果。',
    });
  }
  if (settings.followRecoil) {
    warnings.push({
      code: 'CS2_FOLLOW_RECOIL',
      message: '此代码已启用跟随后坐力，静态图片不会跟随武器后坐力移动。',
    });
  }
  if (settings.deployedWeaponGapEnabled) {
    warnings.push({
      code: 'CS2_WEAPON_GAP',
      message: '此代码已启用随武器调整间隙，静态图片无法根据当前武器改变间隙。',
    });
  }
  return { game: 'cs2', code, settings, warnings };
}
