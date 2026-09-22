import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { decodePng, encodePng } from '../src/node';
import { readFileSync } from 'node:fs';
const structural = JSON.parse(readFileSync(new URL('./fixtures/png-structure.json', import.meta.url), 'utf8')) as {hex: Record<string,string>};

function fixture() {
  const png = new PNG({ width: 2, height: 1 });
  png.data = Buffer.from([10, 20, 30, 128, 0, 255, 0, 255]);
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6 });
}

describe('bounded PNG import and export', () => {
  it.each(['truncated-zlib','extra-scanline','trailing-compressed-data','oversized-palette',
    'palette-after-data','duplicate-palette','split-idat','palette-in-grayscale','invalid-transparency'])
    ('rejects CRC-valid but structurally invalid PNG: %s', name => {
      expect(() => decodePng(Buffer.from(structural.hex[name]!, 'hex')))
        .toThrowError(expect.objectContaining({code:'INVALID_PNG'}));
    });

  it.each([['valid-indexed',255],['valid-indexed-alpha',128]] as const)
    ('accepts a bounded indexed PNG: %s', (name,alpha) => {
      expect([...decodePng(Buffer.from(structural.hex[name]!, 'hex')).data]).toEqual([10,20,30,alpha]);
    });

  it('decodes real PNG pixels and dimensions including partial transparency', () => {
    const result = decodePng(fixture());
    expect([result.width, result.height]).toEqual([2, 1]);
    expect(Array.from(result.data)).toEqual([10, 20, 30, 128, 0, 255, 0, 255]);
  });

  it('respects the byte offset of a sliced buffer', () => {
    const encoded = fixture();
    const padded = Buffer.concat([Buffer.alloc(17), encoded, Buffer.alloc(3)]);
    expect(decodePng(padded.subarray(17, 17 + encoded.length)).data[3]).toBe(128);
  });

  it('exports a PNG that an independent reader decodes to exact RGBA bytes', () => {
    const encoded = encodePng({ width: 2, height: 1,
      data: new Uint8Array([255, 30, 40, 64, 0, 0, 0, 0]), warnings: [] });
    const read = PNG.sync.read(Buffer.from(encoded));
    expect([read.width, read.height]).toEqual([2, 1]);
    expect([...read.data]).toEqual([255, 30, 40, 64, 0, 0, 0, 0]);
  });

  it('does not modify an imported input buffer', () => {
    const bytes = fixture();
    const original = Buffer.from(bytes);
    const image = decodePng(bytes);
    image.data.fill(0);
    expect(bytes).toEqual(original);
  });

  it.each([new Uint8Array(), new Uint8Array([137,80,78,71]), new TextEncoder().encode('<svg/>')])
    ('rejects missing, truncated or non-PNG input', bytes => {
      expect(() => decodePng(bytes)).toThrowError(expect.objectContaining({ code: 'INVALID_PNG' }));
    });

  it('rejects damaged chunk CRC', () => {
    const bytes = fixture();
    bytes[29] = bytes[29]! ^ 1;
    expect(() => decodePng(bytes)).toThrowError(expect.objectContaining({ code: 'INVALID_PNG' }));
  });

  it('validates even ancillary chunk CRCs and strips metadata on new export', () => {
    const bytes = fixture();
    // CRC independently calculated with Python zlib.crc32 over tEXt + k\0abc.
    const text = Buffer.from('00000005744558746b006162638e357c75', 'hex');
    const withText = Buffer.concat([bytes.subarray(0,33), text, bytes.subarray(33)]);
    const image = decodePng(withText);
    expect(Array.from(image.data)).toEqual([10,20,30,128,0,255,0,255]);
    expect(Buffer.from(encodePng(image)).includes(Buffer.from('tEXt'))).toBe(false);
    withText[46] = withText[46]! ^ 1;
    expect(() => decodePng(withText)).toThrowError(expect.objectContaining({ code: 'INVALID_PNG' }));
  });

  it('rejects truncated chunk payload and trailing data after IEND', () => {
    const bytes = fixture();
    for (const invalid of [bytes.subarray(0, bytes.length - 7), Buffer.concat([bytes, Buffer.from([0])])]) {
      expect(() => decodePng(invalid)).toThrowError(expect.objectContaining({ code: 'INVALID_PNG' }));
    }
  });

  it('rejects an oversized compressed input before trying to decode it', () => {
    expect(() => decodePng(new Uint8Array(2 * 1024 * 1024 + 1)))
      .toThrowError(expect.objectContaining({ code: 'IMAGE_TOO_LARGE' }));
  });

  it('rejects oversized IHDR dimensions before decompression', () => {
    const bytes = fixture();
    bytes.writeUInt32BE(513, 16);
    expect(() => decodePng(bytes)).toThrowError(expect.objectContaining({ code: 'IMAGE_TOO_LARGE' }));
  });

  it.each([[24,16], [28,1]])('rejects unsupported depth/interlace before decompression', (offset,value) => {
    const bytes = fixture();
    bytes[offset!] = value!;
    expect(() => decodePng(bytes)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PNG' }));
  });

  it('rejects APNG rather than silently using its first frame', () => {
    const bytes = fixture();
    const animation = Buffer.from('000000086163544c000000020000000000000000', 'hex');
    const invalid = Buffer.concat([bytes.subarray(0,33), animation, bytes.subarray(33)]);
    expect(() => decodePng(invalid)).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PNG' }));
  });

  it('rejects dimension and byte-length mismatches at export', () => {
    for (const image of [
      {width:0,height:1,data:new Uint8Array(),warnings:[]},
      {width:513,height:1,data:new Uint8Array(2052),warnings:[]},
      {width:1,height:1,data:new Uint8Array(3),warnings:[]},
      {width:1.5,height:1,data:new Uint8Array(6),warnings:[]},
    ]) expect(() => encodePng(image)).toThrowError(expect.objectContaining({ code: 'INVALID_PNG' }));
  });
});
