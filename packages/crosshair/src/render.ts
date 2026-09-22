/**
 * VALORANT base geometry and preset colors reference genesy/crosshair-codes,
 * MIT, Copyright 2023 Gene Sy, revision ddb7aaae72fae7e3185f6043869e89f5716e5e1e.
 * See THIRD_PARTY_NOTICES.md. Supersampling and union compositing are local policy;
 * CS2 geometry is a product approximation, not the original game's renderer.
 */
import { CrosshairError, type CrosshairWarning } from './errors';
import type { Cs2Crosshair } from './cs2';
import type { ValorantCrosshair, ValorantLine } from './valorant';
import type { CrosshairProfile, CrosshairRect, CrosshairScene, ParsedCrosshair, RasterImage, RenderOptions } from './render-types';

function invalid(message: string, en: string): never {
  throw new CrosshairError('INVALID_RENDER_OPTIONS', message, en);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Field { zh: string; en: string }
function finite(value: unknown, minimum: number, maximum: number, field: Field): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${field.zh} 必须是 ${minimum} 到 ${maximum} 之间的有限数值。`, `${field.en} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, field: Field): number {
  const result = finite(value, minimum, maximum, field);
  if (!Number.isInteger(result)) invalid(`${field.zh} 必须是整数。`, `${field.en} must be an integer.`);
  return result;
}

function boolean(value: unknown, field: Field): boolean {
  if (typeof value !== 'boolean') invalid(`${field.zh} 必须是布尔值。`, `${field.en} must be a boolean.`);
  return value;
}

function copyWarnings(value: unknown): CrosshairWarning[] {
  if (!Array.isArray(value) || value.length > 128) invalid('准星警告列表无效。', 'Invalid crosshair warning list.');
  return value.map(warning => {
    if (!isRecord(warning) || typeof warning.code !== 'string' || typeof warning.message !== 'string') {
      invalid('准星警告内容无效。', 'Invalid crosshair warning content.');
    }
    return { code: warning.code, message: warning.message };
  });
}

function readOptions(options: RenderOptions | undefined): Required<RenderOptions> {
  if (options !== undefined && !isRecord(options)) invalid('渲染选项必须是对象。', 'Render options must be an object.');
  const size = integer(options?.size === undefined ? 128 : options.size, 16, 512, { zh: '画布尺寸', en: 'canvas size' });
  const scale = finite(options?.scale === undefined ? 1 : options.scale, 0.25, 8, { zh: '缩放比例', en: 'scale factor' });
  const profile = options?.profile === undefined ? 'primary' : options.profile;
  if (profile !== 'primary' && profile !== 'ads') invalid('准星模式必须是 primary 或 ads。', 'The crosshair profile must be primary or ads.');
  return { size, scale, profile };
}

function validateScene(scene: CrosshairScene): void {
  if (!isRecord(scene)) invalid('准星场景必须是对象。', 'The crosshair scene must be an object.');
  if (!Array.isArray(scene.color) || scene.color.length !== 4) invalid('准星颜色必须包含四个 RGBA 字节。', 'The crosshair color must have four RGBA bytes.');
  for (const channel of scene.color) integer(channel, 0, 255, { zh: '颜色通道', en: 'color channel' });
  finite(scene.outlineThickness, 0, 2048, { zh: '描边宽度', en: 'outline thickness' });
  finite(scene.outlineOpacity, 0, 1, { zh: '描边透明度', en: 'outline opacity' });
  // Game scenes contain at most nine rectangles. Bound public JavaScript callers too.
  if (!Array.isArray(scene.rectangles) || scene.rectangles.length > 32) invalid('准星最多支持 32 个矩形。', 'A crosshair supports at most 32 rectangles.');
  for (const rectangle of scene.rectangles) {
    if (!isRecord(rectangle)) invalid('准星矩形数据无效。', 'Invalid crosshair rectangle data.');
    finite(rectangle.x, -2048, 2048, { zh: '矩形横坐标', en: 'rectangle x' });
    finite(rectangle.y, -2048, 2048, { zh: '矩形纵坐标', en: 'rectangle y' });
    finite(rectangle.width, 0, 2048, { zh: '矩形宽度', en: 'rectangle width' });
    finite(rectangle.height, 0, 2048, { zh: '矩形高度', en: 'rectangle height' });
    finite(rectangle.opacity, 0, 1, { zh: '矩形透明度', en: 'rectangle opacity' });
  }
}

const CS2_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 255, 255],
];
const VALORANT_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 255, 255], [0, 255, 0], [127, 255, 0], [223, 255, 0],
  [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 0, 0],
];

function addArms(rectangles: CrosshairRect[], gap: number, thickness: number,
  horizontal: number, vertical: number, opacity: number, noTop = false): void {
  if (thickness === 0) return;
  if (horizontal > 0) {
    rectangles.push(
      { x: -gap - horizontal, y: -thickness / 2, width: horizontal, height: thickness, opacity },
      { x: gap, y: -thickness / 2, width: horizontal, height: thickness, opacity },
    );
  }
  if (vertical > 0) {
    if (!noTop) rectangles.push({ x: -thickness / 2, y: -gap - vertical, width: thickness, height: vertical, opacity });
    rectangles.push({ x: -thickness / 2, y: gap, width: thickness, height: vertical, opacity });
  }
}

function addDot(rectangles: CrosshairRect[], thickness: number, opacity: number): void {
  if (thickness > 0) rectangles.push({ x: -thickness / 2, y: -thickness / 2, width: thickness, height: thickness, opacity });
}

function createCs2Scene(parsed: Cs2Crosshair, warnings: CrosshairWarning[]): CrosshairScene {
  const settings = parsed.settings;
  if (!isRecord(settings)) invalid('CS2 准星设置无效。', 'Invalid CS2 crosshair settings.');
  const length = finite(settings.length, 0, 512, { zh: 'CS2 线条长度', en: 'CS2 line length' }) * 2;
  const thickness = Math.max(1, finite(settings.thickness, 0, 512, { zh: 'CS2 线条粗细', en: 'CS2 line thickness' }) * 2);
  const gap = Math.max(0, finite(settings.gap, -1024, 1024, { zh: 'CS2 间隙', en: 'CS2 gap' }) + 4);
  const paletteIndex = integer(settings.color, 0, 5, { zh: 'CS2 颜色编号', en: 'CS2 color index' });
  const customColor: [number, number, number] = [
    integer(settings.red, 0, 255, { zh: 'CS2 红色通道', en: 'CS2 red channel' }), integer(settings.green, 0, 255, { zh: 'CS2 绿色通道', en: 'CS2 green channel' }),
    integer(settings.blue, 0, 255, { zh: 'CS2 蓝色通道', en: 'CS2 blue channel' }),
  ];
  const alphaEnabled = boolean(settings.alphaEnabled, { zh: 'CS2 启用透明度', en: 'CS2 alpha enabled' });
  const alpha = integer(settings.alpha, 0, 255, { zh: 'CS2 透明度', en: 'CS2 alpha' });
  const outlineEnabled = boolean(settings.outlineEnabled, { zh: 'CS2 启用描边', en: 'CS2 outline enabled' });
  const outline = finite(settings.outline, 0, 2048, { zh: 'CS2 描边宽度', en: 'CS2 outline width' });
  const noTop = boolean(settings.tStyleEnabled, { zh: 'CS2 T 型准星', en: 'CS2 T-style crosshair' });
  const centerDot = boolean(settings.centerDotEnabled, { zh: 'CS2 中心点', en: 'CS2 center dot' });
  const color = paletteIndex === 5 ? customColor : CS2_COLORS[paletteIndex]!;
  const rectangles: CrosshairRect[] = [];
  addArms(rectangles, gap, thickness, length, length, 1, noTop);
  if (centerDot) addDot(rectangles, thickness, 1);
  if (!warnings.some(warning => warning.code === 'STATIC_APPROXIMATION')) {
    warnings.push({ code: 'STATIC_APPROXIMATION', message: 'CS2 预览使用 Aimloom 的静态近似几何与预设配色，不保证与游戏中的像素完全一致。' });
  }
  return { rectangles, color: [color[0], color[1], color[2], alphaEnabled ? alpha : 255],
    outlineThickness: outlineEnabled ? outline : 0, outlineOpacity: 1, warnings };
}

function addValorantLine(rectangles: CrosshairRect[], line: ValorantLine): void {
  if (!isRecord(line)) invalid('VALORANT 线条设置无效。', 'Invalid VALORANT line settings.');
  const enabled = boolean(line.enabled, { zh: 'VALORANT 显示线条', en: 'VALORANT show line' });
  const opacity = finite(line.opacity, 0, 1, { zh: 'VALORANT 线条透明度', en: 'VALORANT line opacity' });
  const length = finite(line.length, 0, 1024, { zh: 'VALORANT 水平长度', en: 'VALORANT horizontal length' });
  const vertical = finite(line.verticalLength, 0, 1024, { zh: 'VALORANT 垂直长度', en: 'VALORANT vertical length' });
  const independent = boolean(line.independentVerticalLength, { zh: 'VALORANT 独立垂直长度', en: 'VALORANT independent vertical length' });
  const thickness = finite(line.thickness, 0, 1024, { zh: 'VALORANT 线条粗细', en: 'VALORANT line thickness' });
  const gap = finite(line.offset, 0, 1024, { zh: 'VALORANT 线条间隙', en: 'VALORANT line gap' });
  if (enabled) addArms(rectangles, gap, thickness, length, independent ? vertical : length, opacity);
}

function createValorantScene(parsed: ValorantCrosshair, profile: CrosshairProfile, warnings: CrosshairWarning[]): CrosshairScene {
  if (!isRecord(parsed.global)) invalid('VALORANT 全局设置无效。', 'Invalid VALORANT global settings.');
  const primaryForAds = boolean(parsed.global.usePrimaryForAds, { zh: 'VALORANT 开镜使用主准星', en: 'VALORANT use primary for ADS' });
  const settings = profile === 'ads' && !primaryForAds ? parsed.ads : parsed.primary;
  if (!isRecord(settings)) invalid('VALORANT 准星设置无效。', 'Invalid VALORANT crosshair settings.');
  const custom = boolean(settings.useCustomColor, { zh: 'VALORANT 启用自定义颜色', en: 'VALORANT custom color enabled' });
  const paletteIndex = integer(settings.color, 0, custom ? 8 : 7, { zh: 'VALORANT 颜色编号', en: 'VALORANT color index' });
  let color: [number, number, number, number];
  if (custom) {
    if (typeof settings.customColor !== 'string' || !/^[0-9A-Fa-f]{8}$/.test(settings.customColor)) {
      invalid('VALORANT 自定义颜色必须为 8 位 RGBA 十六进制值。', 'The VALORANT custom color must be an 8-digit RGBA hex value.');
    }
    const hex = settings.customColor;
    color = [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16), Number.parseInt(hex.slice(6, 8), 16)];
  } else {
    const rgb = VALORANT_COLORS[paletteIndex]!;
    color = [rgb[0], rgb[1], rgb[2], 255];
  }
  const outlineEnabled = boolean(settings.outlines, { zh: 'VALORANT 启用描边', en: 'VALORANT outlines enabled' });
  const outline = finite(settings.outlineThickness, 0, 2048, { zh: 'VALORANT 描边宽度', en: 'VALORANT outline width' });
  const outlineOpacity = finite(settings.outlineOpacity, 0, 1, { zh: 'VALORANT 描边透明度', en: 'VALORANT outline opacity' });
  const centerDot = boolean(settings.centerDot, { zh: 'VALORANT 中心点', en: 'VALORANT center dot' });
  const dotThickness = finite(settings.dotThickness, 0, 1024, { zh: 'VALORANT 中心点粗细', en: 'VALORANT center dot thickness' });
  const dotOpacity = finite(settings.dotOpacity, 0, 1, { zh: 'VALORANT 中心点透明度', en: 'VALORANT center dot opacity' });
  const rectangles: CrosshairRect[] = [];
  addValorantLine(rectangles, settings.inner);
  addValorantLine(rectangles, settings.outer);
  if (centerDot) addDot(rectangles, dotThickness, dotOpacity);
  return { rectangles, color, outlineThickness: outlineEnabled ? outline : 0, outlineOpacity, warnings };
}

export function createScene(parsed: ParsedCrosshair, profile: CrosshairProfile = 'primary'): CrosshairScene {
  if (profile !== 'primary' && profile !== 'ads') {
    throw new CrosshairError('UNSUPPORTED_PROFILE', '仅支持 primary 和 ads 准星模式。', 'Only the primary and ads crosshair profiles are supported.');
  }
  if (!isRecord(parsed) || (parsed.game !== 'cs2' && parsed.game !== 'valorant')) invalid('无法识别准星游戏类型。', 'Unrecognized crosshair game type.');
  if (parsed.game === 'cs2' && profile === 'ads') {
    throw new CrosshairError('UNSUPPORTED_PROFILE', 'CS2 准星代码不包含独立的 ADS 准星。', 'A CS2 crosshair code has no separate ADS crosshair.');
  }
  const warnings = copyWarnings(parsed.warnings);
  const scene = parsed.game === 'cs2' ? createCs2Scene(parsed, warnings) : createValorantScene(parsed, profile, warnings);
  validateScene(scene);
  return scene;
}

export function renderScene(scene: CrosshairScene, options?: RenderOptions): RasterImage {
  const { size, scale } = readOptions(options);
  validateScene(scene);
  const warnings = copyWarnings(scene.warnings);
  const center = size / 2;
  const outline = scene.outlineOpacity > 0 ? scene.outlineThickness * scale : 0;
  const rectangles = scene.rectangles.filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({
    x: center + rect.x * scale, y: center + rect.y * scale,
    width: rect.width * scale, height: rect.height * scale, opacity: rect.opacity,
  }));
  let left = size;
  let top = size;
  let right = 0;
  let bottom = 0;
  for (const rect of rectangles) {
    left = Math.min(left, rect.x - outline);
    top = Math.min(top, rect.y - outline);
    right = Math.max(right, rect.x + rect.width + outline);
    bottom = Math.max(bottom, rect.y + rect.height + outline);
  }
  if (left < 0 || top < 0 || right > size || bottom > size) {
    invalid('准星超出画布范围；请增大画布或减小缩放比例。', 'The crosshair exceeds the canvas; increase the canvas size or reduce the scale.');
  }

  const data = new Uint8Array(size * size * 4);
  const colorAlpha = scene.color[3] / 255;
  let visible = false;
  for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
    for (let x = Math.floor(left); x < Math.ceil(right); x++) {
      let alphaSum = 0;
      let foregroundAlphaSum = 0;
      let alphaCompensation = 0;
      let foregroundCompensation = 0;
      for (let sy = 0; sy < 4; sy++) {
        const sampleY = y + (sy + 0.5) / 4;
        for (let sx = 0; sx < 4; sx++) {
          const sampleX = x + (sx + 0.5) / 4;
          let insideForeground = false;
          let insideOutline = false;
          let opacity = 0;
          for (const rect of rectangles) {
            if (contains(rect, sampleX, sampleY, 0)) {
              insideForeground = true;
              opacity = Math.max(opacity, rect.opacity);
            } else if (outline > 0 && contains(rect, sampleX, sampleY, outline)) {
              insideOutline = true;
            }
          }
          // Membership, not opacity, masks the outline: transparent fills stay clear.
          const foregroundAlpha = insideForeground ? opacity * colorAlpha : 0;
          const alpha = insideForeground ? foregroundAlpha : insideOutline ? scene.outlineOpacity : 0;
          // Compensated sums keep byte rounding stable (e.g. sixteen 0.7 samples
          // must round alpha 178.5 upward, not drift just below the half-byte).
          const alphaIncrement = alpha - alphaCompensation;
          const nextAlpha = alphaSum + alphaIncrement;
          alphaCompensation = (nextAlpha - alphaSum) - alphaIncrement;
          alphaSum = nextAlpha;
          const foregroundIncrement = foregroundAlpha - foregroundCompensation;
          const nextForeground = foregroundAlphaSum + foregroundIncrement;
          foregroundCompensation = (nextForeground - foregroundAlphaSum) - foregroundIncrement;
          foregroundAlphaSum = nextForeground;
        }
      }
      const alphaByte = Math.round(alphaSum * 255 / 16);
      if (alphaByte === 0) continue;
      visible = true;
      const index = (y * size + x) * 4;
      // Black has no RGB contribution; divide the integrated premultiplied color
      // by integrated alpha only after all sixteen samples have been accumulated.
      const foregroundFraction = foregroundAlphaSum / alphaSum;
      data[index] = Math.round(scene.color[0] * foregroundFraction);
      data[index + 1] = Math.round(scene.color[1] * foregroundFraction);
      data[index + 2] = Math.round(scene.color[2] * foregroundFraction);
      data[index + 3] = alphaByte;
    }
  }
  if (!visible && !warnings.some(warning => warning.code === 'EMPTY_CROSSHAIR')) {
    warnings.push({ code: 'EMPTY_CROSSHAIR', message: '当前设置生成了完全透明的准星，请检查线条、中心点和透明度。' });
  }
  return { width: size, height: size, data, warnings };
}

function contains(rect: CrosshairRect, x: number, y: number, expansion: number): boolean {
  return x >= rect.x - expansion && x < rect.x + rect.width + expansion &&
    y >= rect.y - expansion && y < rect.y + rect.height + expansion;
}

export function renderCrosshair(parsed: ParsedCrosshair, options?: RenderOptions): RasterImage {
  const normalized = readOptions(options);
  return renderScene(createScene(parsed, normalized.profile), normalized);
}

export function toSvg(image: RasterImage): string {
  if (!isRecord(image)) invalid('图像数据必须是对象。', 'Image data must be an object.');
  const width = integer(image.width, 1, 512, { zh: '图像宽度', en: 'image width' });
  const height = integer(image.height, 1, 512, { zh: '图像高度', en: 'image height' });
  if (!(image.data instanceof Uint8Array) || image.data.length !== width * height * 4) {
    invalid('图像 RGBA 字节数与尺寸不一致。', "The image's RGBA byte count does not match its dimensions.");
  }
  const data = image.data;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width;) {
      const index = (y * width + x) * 4;
      const red = data[index]!;
      const green = data[index + 1]!;
      const blue = data[index + 2]!;
      const alpha = data[index + 3]!;
      if (alpha === 0) { x++; continue; }
      let end = x + 1;
      while (end < width) {
        const next = (y * width + end) * 4;
        if (data[next] !== red || data[next + 1] !== green || data[next + 2] !== blue || data[next + 3] !== alpha) break;
        end++;
      }
      parts.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="rgb(${red},${green},${blue})" fill-opacity="${alpha / 255}"/>`);
      x = end;
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
