import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CrosshairError, parseCrosshair, renderCrosshair } from '../src/index';
import type { RasterImage, RenderOptions } from '../src/index';
import { decodePng, MAX_PNG_BYTES } from '../src/node';
export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');

export function argumentsMap(args: string[]): Map<string,string> {
  const allowed = new Set(['--code','--input','--output','--size','--scale','--profile']);
  const values = new Map<string,string>();
  for (let i=0; i<args.length; i+=2) {
    const key=args[i]!, value=args[i+1];
    if (!allowed.has(key) || values.has(key) || value === undefined || value.startsWith('--')) {
      throw new CrosshairError('INVALID_VALUE', '参数缺失、重复或不受支持；使用 --help 查看用法', 'A missing, duplicate or unsupported argument; use --help to see usage');
    }
    values.set(key,value);
  }
  if (values.has('--code') === values.has('--input') || !values.get('--output')) {
    throw new CrosshairError('INVALID_VALUE', '必须选择一种输入（--code 或 --input），并指定 --output', 'Choose one input (--code or --input), and specify --output');
  }
  return values;
}

async function readPngFile(path: string): Promise<{ image: RasterImage; bytes: Uint8Array }> {
  if (!(await lstat(path)).isFile()) throw new CrosshairError('INVALID_PNG', '请输入普通 PNG 文件路径', 'Enter the path to a plain PNG file');
  const handle=await open(path,'r');
  try {
    const info=await handle.stat();
    if (!info.isFile()) throw new CrosshairError('INVALID_PNG', '请输入普通 PNG 文件路径', 'Enter the path to a plain PNG file');
    if (info.size > MAX_PNG_BYTES) throw new CrosshairError('IMAGE_TOO_LARGE', '准星 PNG 文件不能超过 2 MiB', 'The crosshair PNG file cannot exceed 2 MiB');
    // Read at most the observed file size plus one, so concurrent growth is bounded.
    const bytes=Buffer.alloc(info.size+1);
    let count=0;
    while (count<bytes.length) {
      const next=await handle.read(bytes,count,bytes.length-count,null);
      if (!next.bytesRead) break;
      count+=next.bytesRead;
    }
    if (count!==info.size) throw new CrosshairError('IO_ERROR', '读取过程中图片发生变化，请重试', 'The image changed while being read; try again');
    const input=bytes.subarray(0,count);
    return { image: decodePng(input), bytes: input };
  } finally { await handle.close(); }
}

export async function loadInput(values: Map<string,string>) {
  let image: RasterImage;
  if (values.has('--input')) {
    if (['--size','--scale','--profile'].some(key=>values.has(key))) {
      throw new CrosshairError('INVALID_VALUE', 'PNG 导入保持原始像素，不接受尺寸、缩放或代码分组参数', 'A PNG import keeps its original pixels; it does not accept size, scale or code-group arguments');
    }
    const {image,bytes}=await readPngFile(values.get('--input')!);
    return {image, source:{kind:'png',sha256:sha256(bytes)}, render:{width:image.width,height:image.height}};
  } else {
    const options: RenderOptions={};
    if (values.has('--size')) options.size=Number(values.get('--size'));
    if (values.has('--scale')) options.scale=Number(values.get('--scale'));
    if (values.has('--profile')) {
      const profile=values.get('--profile');
      if (profile!=='primary' && profile!=='ads') throw new CrosshairError('UNSUPPORTED_PROFILE', '当前支持 primary 或 ads 准星预览', 'Only the primary or ads crosshair preview is currently supported');
      options.profile=profile;
    }
    const parsed=parseCrosshair(values.get('--code')!);
    image=renderCrosshair(parsed,options);
    return {image,source:{kind:'code',game:parsed.game,code:parsed.code,sha256:sha256(values.get('--code')!)},render:{width:image.width,height:image.height,size:options.size??128,scale:options.scale??1,profile:options.profile??'primary'}};
  }
}
