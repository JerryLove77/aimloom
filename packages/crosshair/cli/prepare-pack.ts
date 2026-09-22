import { mkdir, mkdtemp, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CrosshairError, toSvg } from '../src/index';
import { decodePng, encodePng } from '../src/node';
import { argumentsMap, loadInput, sha256 } from './input';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const help=`准星安装包导出（开发命令，不自动安装或选择游戏准星）
npm run crosshair:pack -- --code '<CS2 或 VALORANT 代码>' --output <新目录>
npm run crosshair:pack -- --input <已有准星.png> --output <新目录>
代码选项：--size 128（16–512 整数），--scale 1（0.25–8），--profile primary|ads
PNG 保留原始像素，不接受代码渲染选项。相对路径以仓库根目录为基准。已有目录不会被覆盖。`;

async function main(){
 const args=process.argv.slice(2);
 if(args.length===1 && args[0]==='--help'){console.log(help);return;}
 const values=argumentsMap(args);
 // Workspace scripts change cwd; pack paths consistently use the repository root.
 if(values.has('--input')) values.set('--input',resolve(repo,values.get('--input')!));
 const output=resolve(repo,values.get('--output')!);
 const {image,source,render}=await loadInput(values);
 const filename=`aimloom_${randomUUID().replaceAll('-','')}.png`;
 const png=encodePng(image);
 const decoded=decodePng(png);
 if(!Buffer.from(decoded.data).equals(Buffer.from(image.data))) throw new CrosshairError('IO_ERROR','导出像素校验失败','Exported pixel verification failed');
 const notices=await readFile(join(repo,'THIRD_PARTY_NOTICES.md'));
 const instructions='\uFEFF准星安装包 · Aimloom\r\n\r\n'+
  `准星文件：${filename}\r\n`+
  '此命令只导出本地文件，尚未安装，也未在游戏中选择准星。\r\n'+
  '请在游戏目录之外保存此包。关闭 KovaaK，使用配置安装器选择本目录，检查预览中的唯一 PNG 后确认安装。安装器负责备份与恢复。\r\n'+
  '安装后需在 KovaaK 中手动选择该准星。对比原始颜色时，将 TINT 设为白色 FFFFFF；菜单淡出不等于 PNG 透明度。\r\n'+
  '导出尺寸与缩放不等于游戏内缩放。CS2 是静态近似，不模拟移动、开火或后坐力。此包尚未经过游戏内验证。\r\n'+
  'PNG 导入保持源像素与尺寸，重新编码会移除附加元数据。\r\n'+
  image.warnings.map(w=>`[${w.code}] ${w.message}\r\n`).join('');
 const payloads:Record<string,Uint8Array|string>={
  [`crosshairs/${filename}`]:png,'preview.svg':toSvg(image),'START_HERE.txt':instructions,'THIRD_PARTY_NOTICES.md':notices,
 };
 const artifacts=Object.fromEntries(Object.entries(payloads).map(([path,bytes])=>[path,{sha256:sha256(bytes),bytes:Buffer.byteLength(bytes)}]));
 payloads['manifest.json']=JSON.stringify({schemaVersion:1,source,render,warnings:image.warnings,gameValidation:'not_run',artifacts},null,2)+'\n';
 payloads['SHA256SUMS.txt']=Object.entries(payloads).map(([path,bytes])=>`${sha256(bytes)}  ${path}\n`).join('');
 // Reserve exclusively, never recursively create or remove user-owned paths.
 try{await mkdir(output);}catch(error){
  if((error as NodeJS.ErrnoException).code==='EEXIST') throw new CrosshairError('OUTPUT_EXISTS','输出目录已存在，请选择新目录','The output directory already exists; choose a new directory');
  throw error;
 }
 const staging=await mkdtemp(join(output,'.aimloom-staging-'));
 await mkdir(join(staging,'crosshairs'));
 for(const [path,bytes] of Object.entries(payloads)){
  await writeFile(join(staging,path),bytes,{flag:'wx'});
  if(!Buffer.from(bytes).equals(await readFile(join(staging,path)))) throw new CrosshairError('IO_ERROR','写入文件校验失败','Writing the file failed verification');
 }
 // The installer does not require a manifest: publish its recognizable folder LAST.
 // An interrupted export can leave metadata/private staging, but no installable PNG.
 for(const path of Object.keys(payloads).filter(path=>!path.startsWith('crosshairs/'))){
  await writeFile(join(output,path),await readFile(join(staging,path)),{flag:'wx'});
  if(!Buffer.from(payloads[path]!).equals(await readFile(join(output,path)))) throw new CrosshairError('IO_ERROR','导出文件校验失败','Exported file verification failed');
 }
 // Remove only known staging metadata, without recursively deleting unexpected files.
 const {unlink}=await import('node:fs/promises');
 for(const path of Object.keys(payloads).filter(path=>!path.startsWith('crosshairs/'))) await unlink(join(staging,path));
 await rename(join(staging,'crosshairs'),join(output,'crosshairs'));
 await rmdir(staging);
 for(const warning of image.warnings) console.error(`[${warning.code}] ${warning.message}`);
 console.log(JSON.stringify({output,crosshair:`crosshairs/${filename}`,width:image.width,height:image.height,warnings:image.warnings.map(w=>w.code)}));
}
main().catch(error=>{
 if(error instanceof CrosshairError) console.error(`[${error.code}] ${error.message}`);
 else console.error('[IO_ERROR] 无法读写导出目录，请检查路径和权限；未完成目录请勿用于安装');
 process.exitCode=1;
});
