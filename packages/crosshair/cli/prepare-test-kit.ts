import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrosshairError, parseCrosshair, renderCrosshair, toSvg } from '../src/index';
import { decodePng, encodePng } from '../src/node';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const repo=fileURLToPath(new URL('../../../',import.meta.url));
type Case={scale?:number;baseCase?:string;id:string;title:string;code:string;inspect:string;provenance:{kind:string;reference:string}};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function git(...args:string[]):string|null {
  try{return execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim();}
  catch{return null;}
}

async function main() {
  const rawArgs=process.argv.slice(2);
  const calibration=rawArgs[0]==='--calibration';
  const args=calibration?rawArgs.slice(1):rawArgs;
  if(args.length===1&&args[0]==='--help') {
    console.log('准备 KovaaK 实机测试包：npm run test:crosshair:prepare -- [--calibration] [--output <新目录>]\n默认输出到 dist/crosshair-game-kit/ 下的独立目录；不会安装或更改游戏文件。');
    return;
  }
  if(args.length!==0&&(args.length!==2||args[0]!=='--output'||!args[1]||args[1].startsWith('--'))) {
    throw new CrosshairError('INVALID_VALUE','使用 --output 指定新目录，或使用 --help 查看用法','Use --output to name a new directory, or --help to see usage');
  }
  const kitId=randomUUID().replaceAll('-','').slice(0,12);
  // npm workspace scripts change cwd, so relative destinations use the repo root.
  const output=args.length?resolve(repo,args[1]!):join(repo,'dist','crosshair-game-kit',kitId);
  const casesText=await readFile(join(packageRoot,'qa','game-cases.json'),'utf8');
  const sourceCases=JSON.parse(casesText) as Case[];
  const cases:Case[]=calibration
    ? ['simple-cross','center-dot','odd-thickness'].flatMap(id=>{
      const item=sourceCases.find(c=>c.id===id);
      if(!item)throw new Error('Missing calibration source');
      return [1,2,3].map(scale=>({...item,baseCase:id,scale,
        id:`${id}-${['one','two','three'][scale-1]}`,title:`${item.title} / ${scale}×`}));
    }) : sourceCases;
  const sourceHash=createHash('sha256');
  for(const name of ['cs2','errors','index','node','render-types','render','valorant']) {
    sourceHash.update(`${name}.ts\0`).update(await readFile(join(packageRoot,'src',`${name}.ts`)));
  }
  const sourceCommit=git('rev-parse','HEAD');
  const gitStatus=git('status','--porcelain','--untracked-files=normal');
  const artifacts:{file:string;bytes:Uint8Array|string}[]=[];
  const seen=new Set<string>();
  const entries=cases.map(item=>{
    if(!/^[a-z][a-z-]+$/.test(item.id)||seen.has(item.id)) throw new Error('Invalid QA case ID');
    seen.add(item.id);
    const options={size:128,scale:item.scale??1};
    const parsed=parseCrosshair(item.code);
    const image=renderCrosshair(parsed,options);
    const png=encodePng(image),svg=toSvg(image);
    const decoded=decodePng(png);
    if(decoded.width!==128||decoded.height!==128||!Buffer.from(decoded.data).equals(Buffer.from(image.data))) {
      throw new Error('PNG round-trip mismatch');
    }
    let pixelBounds: {x:number;y:number;width:number;height:number}|undefined;
    if(calibration){
      let left=128,top=128,right=-1,bottom=-1;
      for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(decoded.data[(y*128+x)*4+3]){
        left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
      }
      if(left<=0||top<=0||right>=127||bottom>=127||right<left||left+right!==127||top+bottom!==127){
        throw new Error('Calibration must be visible, centered and unclipped');
      }
      pixelBounds={x:left,y:top,width:right-left+1,height:bottom-top+1};
    }
    const base=`aimloom_test_${kitId}_${item.id}`;
    const pngFile=`crosshairs/${base}.png`,svgFile=`previews/${base}.svg`;
    artifacts.push({file:pngFile,bytes:png},{file:svgFile,bytes:svg});
    return {...item,...(pixelBounds?{pixelBounds}:{}),game:parsed.game,options,png:{file:pngFile,sha256:sha(png),bytes:png.length},
      svg:{file:svgFile,sha256:sha(svg),bytes:Buffer.byteLength(svg)},warnings:image.warnings};
  });
  const guide=await readFile(join(packageRoot,'qa',calibration?'KOVAAK_SIZE_TEST.md':'KOVAAK_TEST.md'),'utf8');
  const notices=await readFile(join(repo,'THIRD_PARTY_NOTICES.md'),'utf8');
  const supportFiles=[];
  for(const file of ['Run-Test.cmd','Crosshair-Test.ps1','Crosshair-Test.Core.ps1']) {
    const bytes=await readFile(join(packageRoot,'qa','windows',file));
    artifacts.push({file,bytes});
    supportFiles.push({file,sha256:sha(bytes),bytes:bytes.length});
  }
  const manifest={schemaVersion:1,kitId,createdAt:new Date().toISOString(),sourceCommit,
    sourceTreeStatus:gitStatus===null?'unknown':gitStatus?'dirty':'clean',
    rendererSourcesSha256:sourceHash.digest('hex'),casesSha256:sha(casesText),
    generatorSha256:sha(await readFile(fileURLToPath(import.meta.url))),
    ...(calibration?{purpose:'size-calibration'}:{}),targetGame:'KovaaK',gameValidation:'not_run',supportFiles,cases:entries};
  const results={schemaVersion:1,kitId,...(calibration?{sizeDecision:{status:'not_run',preferredScales:{'simple-cross':null,'center-dot':null,'odd-thickness':null}}}:{}),environment:{windowsBuild:null,gameBuild:null,resolution:null,
    displayMode:null,scenario:null,weapon:null},baseline:{crosshair:null,gameScale:null,backupLocation:null,installBatchId:null},
    sourceGameCalibration:'deferred_source_game_unavailable',
    cases:entries.map(item=>({id:item.id,file:item.png.file,gameScale:null,screenshots:[],notes:'',
      checks:{display:'not_run',transparency:'not_run',geometry:'not_run',scale:'not_run',persistence:'not_run',restoration:'not_run'}}))};
  // Complete all generation/read validation before creating the destination. mkdir is
  // exclusive; an existing destination is never refreshed or overwritten.
  await mkdir(dirname(output),{recursive:true});
  try{await mkdir(output);}
  catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new CrosshairError('OUTPUT_EXISTS','目标目录已存在，请选择新目录','The target directory already exists; choose a new directory');throw error;}
  // The native scanner ignores unknown folders: publish recognizable assets only after all metadata is ready.
  await mkdir(join(output,'.crosshairs-staging'));
  await mkdir(join(output,'previews'));
  for(const artifact of artifacts) {
    await writeFile(join(output,artifact.file.replace(/^crosshairs\//,'.crosshairs-staging/')),artifact.bytes,{flag:'wx'});
    if(sha(await readFile(join(output,artifact.file.replace(/^crosshairs\//,'.crosshairs-staging/'))))!==sha(artifact.bytes)) throw new Error('Written artifact hash mismatch');
  }
  const caseGuide=entries.map(item=>`\n### ${item.id}: ${item.title}\n\n文件：\`${item.png.file}\`\n\n${item.inspect}${item.pixelBounds?`\n\n导出倍率：${item.options.scale}×；实际非透明像素范围：${item.pixelBounds.width} × ${item.pixelBounds.height} px。`:""}\n\n提示：${item.warnings.map(w=>w.message).join(' ')||'无额外提示'}\n`).join('');
  await writeFile(join(output,'KOVAAK_TEST.md'),`${guide}\n## 本包实际文件对照\n${caseGuide}`,{flag:'wx'});
  if(calibration)await writeFile(join(output,'START_HERE.txt'),'\uFEFF'+guide+'\n'+caseGuide,{flag:'wx'});
  await writeFile(join(output,'THIRD_PARTY_NOTICES.md'),notices,{flag:'wx'});
  await writeFile(join(output,'SHA256SUMS.txt'),artifacts.map(a=>`${sha(a.bytes)}  ${a.file}`).join('\n')+'\n',{flag:'wx'});
  await writeFile(join(output,'results.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
  // Manifest precedes publication: it alone does not make a kit installable.
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await rename(join(output,'.crosshairs-staging'),join(output,'crosshairs'));
  console.log(JSON.stringify({output,kitId,cases:entries.length,...(calibration?{scales:[1,2,3]}:{scale:1}),gameValidation:'not_run'}));
}

main().catch(error=>{
  if(error instanceof CrosshairError)console.error(`[${error.code}] ${error.message}`);
  else console.error('[IO_ERROR] 测试包准备失败；缺少 manifest.json 或 crosshairs 的目录不可用于实机测试');
  process.exitCode=1;
});
