/** Node-only, UI-independent preview and replacement-pack preparation. No game discovery or writes. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CrosshairError, parseCrosshair, parseCrosshairForGame, renderCrosshair, toSvg } from './index';
import type { RenderOptions, CrosshairGame } from './index';
import { decodePng, encodePng } from './node';

export type CrosshairInput = {kind:'code';game?:CrosshairGame;code:string;options?:RenderOptions} | {kind:'png';bytes:Uint8Array};
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function previewCrosshair(input:CrosshairInput) {
  if(!input || typeof input!=='object' || !['code','png'].includes(input.kind)) {
    throw new CrosshairError('INVALID_VALUE','请选择准星代码或 PNG 输入','Choose a crosshair code or a PNG input.');
  }
  if(input.kind==='png' && ('options' in input || !(input.bytes instanceof Uint8Array))) {
    throw new CrosshairError('INVALID_VALUE','PNG 输入必须是图片字节，且保持原始尺寸','A PNG input must be image bytes, kept at their original size.');
  }
  const parsed=input.kind==='code'
    ? ('game' in input?parseCrosshairForGame(input.game!,input.code):parseCrosshair(input.code)) : null;
  const raster=input.kind==='png'?decodePng(input.bytes):renderCrosshair(parsed!,input.options);
  const png=encodePng(raster);
  const source=input.kind==='code'
    ? {kind:'code' as const,game:parsed!.game,code:parsed!.code}
    : {kind:'png' as const,game:null,sha256:hash(input.bytes)};
  return {source,raster,png,svg:toSvg(raster),width:raster.width,height:raster.height,
    sha256:hash(png),warnings:raster.warnings};
}

export function validateCrosshairFileName(name:string):void {
  if(typeof name!=='string' || name.length>128 || !/^[^\\/:*?"<>|\x00-\x1f]+\.png$/i.test(name)
    || /^[. ]/.test(name) || name.includes('..') || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.split('.')[0]!)) {
    throw new CrosshairError('INVALID_VALUE','替换目标必须是普通 PNG 文件名，不能包含路径或 Windows 保留名称','The replacement target must be a plain PNG file name, with no path and no Windows reserved name.');
  }
}

export async function prepareCrosshairReplacement(input:CrosshairInput, request:{outputDirectory:string;targetFileName:string}) {
  // Pin caller-owned mutable objects before any asynchronous work.
  const targetFileName=request.targetFileName;
  const requestedOutput=request.outputDirectory;
  validateCrosshairFileName(targetFileName);
  if(typeof requestedOutput!=='string' || !requestedOutput.trim())throw new CrosshairError('INVALID_VALUE','请选择新的导出目录','Choose a new export directory.');
  const options=input.kind==='code'?{size:input.options?.size??128,scale:input.options?.scale??1,profile:input.options?.profile??'primary'}:null;
  const preview=previewCrosshair(input.kind==='code'?{...input,options:options!}:input);
  const outputDirectory=resolve(requestedOutput);
  const notices=await readFile(new URL('../../../THIRD_PARTY_NOTICES.md',import.meta.url));
  const pngFile=`crosshairs/${targetFileName}`;
  const manifest={schemaVersion:1,kind:'crosshair-replacement',targetFileName:targetFileName,
    source:preview.source,options,
    png:{file:pngFile,sha256:preview.sha256,bytes:preview.png.length,width:preview.width,height:preview.height},
    warnings:preview.warnings,requiresConfirmation:true,gameSelectionChanged:false};
  try{await mkdir(outputDirectory);}catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw new CrosshairError('OUTPUT_EXISTS','输出目录已存在，不会覆盖','The output directory already exists; it will not be overwritten.');
    throw error;
  }
  const staging=join(outputDirectory,'.pending-crosshairs');await mkdir(staging);
  const asset=join(staging,targetFileName);
  await writeFile(asset,preview.png,{flag:'wx'});
  if(hash(await readFile(asset))!==preview.sha256)throw new CrosshairError('IO_ERROR','PNG 写入校验失败','Writing the PNG failed verification.');
  const files:Record<string,string|Uint8Array>={
    'preview.svg':preview.svg,
    'crosshair-replacement.json':JSON.stringify(manifest,null,2)+'\n',
    'THIRD_PARTY_NOTICES.md':notices,
    'START_HERE.txt':'\uFEFF此包替换同名准星文件，不修改游戏选中、缩放或 TINT。\r\n关闭游戏后，先生成替换预览并确认，再通过现有安装器备份／写入；可按返回批次撤销。\r\n目标：'+targetFileName+'\r\n'+preview.warnings.map(w=>w.message).join('\r\n'),
  };
  for(const [name,bytes] of Object.entries(files)){
    await writeFile(join(outputDirectory,name),bytes,{flag:'wx'});
    if(!Buffer.from(await readFile(join(outputDirectory,name))).equals(Buffer.from(bytes)))throw new CrosshairError('IO_ERROR','元数据写入校验失败','Writing the metadata failed verification.');
  }
  await rename(staging,join(outputDirectory,'crosshairs'));
  return {outputDirectory,targetFileName:targetFileName,pngFile,sha256:preview.sha256,
    width:preview.width,height:preview.height,warnings:preview.warnings,requiresConfirmation:true as const};
}
