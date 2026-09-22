import { argumentsMap, loadInput } from './input';
import { open, unlink } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { CrosshairError, toSvg } from '../src/index';
import { encodePng } from '../src/node';

const help = `准星生成工具（开发命令，只写指定的新文件，不自动安装）

npm run crosshair -- --code '<CS2 或 VALORANT 代码>' --output <新文件.png|新文件.svg>
npm run crosshair -- --input <已有准星.png> --output <新文件.png|新文件.svg>

代码渲染选项：--size 128（16–512 整数），--scale 1（0.25–8），--profile primary|ads
PNG 导入保持原始尺寸，不接受渲染选项。已有输出文件不会被覆盖。
CS2 为静态近似预览；不模拟移动、射击或后坐力，也不自动安装或选择游戏准星。`;

async function main() {
  const args=process.argv.slice(2);
  if (args.length===1 && args[0]==='--help') { console.log(help); return; }
  const values=argumentsMap(args);
  const output=resolve(values.get('--output')!);
  const extension=extname(output).toLowerCase();
  if (extension!=='.png' && extension!=='.svg') {
    throw new CrosshairError('INVALID_VALUE', '输出文件扩展名必须为 .png 或 .svg', 'The output file extension must be .png or .svg');
  }
  const {image}=await loadInput(values);
  const payload=extension==='.png' ? encodePng(image) : toSvg(image);
  let handle;
  try { handle=await open(output,'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code==='EEXIST') {
      throw new CrosshairError('OUTPUT_EXISTS', '输出文件已存在，请选择新文件名', 'The output file already exists; choose a new file name');
    }
    throw error;
  }
  try { await handle.writeFile(payload); }
  catch (error) {
    await handle.close();
    await unlink(output).catch(()=>undefined);
    throw error;
  }
  await handle.close();
  for (const warning of image.warnings) console.error(`[${warning.code}] ${warning.message}`);
  console.log(JSON.stringify({output,width:image.width,height:image.height,warnings:image.warnings.map(w=>w.code)}));
}

main().catch(error=>{
  if (error instanceof CrosshairError) console.error(`[${error.code}] ${error.message}`);
  else console.error('[IO_ERROR] 无法读写指定文件，请检查文件路径和权限');
  process.exitCode=1;
});
