import { PNG } from 'pngjs';
import { inflateSync } from 'node:zlib';
import type { RasterImage } from './render-types';
import { CrosshairError } from './errors';

export const MAX_PNG_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 512;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

function invalid(message = 'PNG 文件损坏或格式不正确', en = 'The PNG file is corrupted or badly formed'): never {
  throw new CrosshairError('INVALID_PNG', message, en);
}

function validDimension(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
}

// Validate every chunk, including ancillary chunks skipped by pngjs's CRC checker.
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function decodePng(bytes: Uint8Array): RasterImage {
  if (!(bytes instanceof Uint8Array)) invalid();
  if (bytes.byteLength > MAX_PNG_BYTES) {
    throw new CrosshairError('IMAGE_TOO_LARGE', '准星 PNG 文件不能超过 2 MiB', 'The crosshair PNG file cannot exceed 2 MiB.');
  }
  if (bytes.length < 33 || signature.some((value, i) => bytes[i] !== value)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) invalid();
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height) invalid('PNG 宽度和高度必须大于零', 'The PNG width and height must be greater than zero');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new CrosshairError('IMAGE_TOO_LARGE', '准星图片宽度和高度均不能超过 512 像素', 'The crosshair image width and height cannot exceed 512 pixels.');
  }
  if (bytes[24] !== 8 || bytes[28] !== 0) {
    throw new CrosshairError('UNSUPPORTED_PNG', '目前仅支持 8 位、非交错 PNG，请先导出为普通 PNG', 'Only 8-bit, non-interlaced PNG is supported; export it as a plain PNG first.');
  }
  const colorType = bytes[25]!;
  if (![0,2,3,4,6].includes(colorType) || bytes[26] !== 0 || bytes[27] !== 0) invalid();

  let cursor = 8, idat = false, ended = false, dataEnded = false;
  let paletteEntries = 0, transparency = false;
  const compressedParts: Uint8Array[] = [];
  while (cursor < bytes.length) {
    if (bytes.length - cursor < 12) invalid();
    const length = view.getUint32(cursor);
    if (length > bytes.length - cursor - 12) invalid();
    const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) invalid();
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new CrosshairError('UNSUPPORTED_PNG', '暂不支持动态 PNG，请导出单帧静态准星', 'Animated PNG is not supported yet; export a single-frame static crosshair.');
    }
    if (type === 'IHDR' && cursor !== 8) invalid('PNG 包含重复图像头');
    if (crc32(bytes, cursor + 4, cursor + 8 + length) !== view.getUint32(cursor + 8 + length)) {
      invalid('PNG 校验失败，文件可能已损坏');
    }
    if (type === 'PLTE') {
      if (idat || paletteEntries || ![2,3,6].includes(colorType) || length < 3 || length > 768 || length % 3 !== 0) {
        invalid('PNG 调色板大小、类型或顺序无效');
      }
      paletteEntries = length / 3;
    }
    if (type === 'tRNS') {
      if (idat || transparency ||
          (colorType === 3 ? !paletteEntries || length < 1 || length > paletteEntries :
            colorType === 0 ? length !== 2 : colorType === 2 ? length !== 6 : true)) {
        invalid('PNG 透明度数据无效');
      }
      transparency = true;
    }
    if (type === 'IDAT') {
      if (dataEnded || (colorType === 3 && !paletteEntries)) invalid('PNG 像素数据顺序无效');
      idat = true;
      compressedParts.push(bytes.subarray(cursor + 8, cursor + 8 + length));
    } else if (idat) dataEnded = true;
    cursor += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || cursor !== bytes.length) invalid();
      ended = true;
      break;
    }
  }
  if (!idat || !ended) invalid();
  try {
    const channels = ({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[colorType]!;
    const expectedBytes = height * (1 + width * channels);
    const compressed = Buffer.concat(compressedParts);
    // pngjs stops as soon as expected pixels are available: independently require
    // a complete Adler-checked stream, exact decoded length and no trailing stream.
    // Node's runtime `info` result is not reflected in @types/node's return overload.
    const inflated = inflateSync(compressed, {maxOutputLength: expectedBytes, info: true}) as unknown as
      {buffer: Buffer; engine: {bytesWritten: number}};
    if (inflated.buffer.length !== expectedBytes || inflated.engine.bytesWritten !== compressed.length) invalid();
    const decoded = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) invalid();
    return { width, height, data: new Uint8Array(decoded.data), warnings: [] };
  } catch (error) {
    if (error instanceof CrosshairError) throw error;
    invalid();
  }
}

export function encodePng(image: RasterImage): Uint8Array {
  if (!image || !validDimension(image.width) || !validDimension(image.height) ||
      !(image.data instanceof Uint8Array) || image.data.length !== image.width * image.height * 4) {
    invalid('准星像素数据与图片尺寸不匹配', "The crosshair's pixel data does not match its image dimensions");
  }
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return new Uint8Array(PNG.sync.write(png, {
    colorType: 6, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, filterType: 4,
  }));
}
