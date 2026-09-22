import { afterEach, beforeEach, expect, it } from 'vitest';
import { access, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { parseCrosshair, renderCrosshair } from '../src/index';
const repo=fileURLToPath(new URL('../../..',import.meta.url));
const cli=fileURLToPath(new URL('../cli/prepare-pack.ts',import.meta.url));
const green='0;s;1;P;c;1;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0';
const cs2='CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG';
const hash=(bytes: Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'aimloom-pack-'));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
function run(...args:string[]) {return spawnSync(process.execPath,['--import','tsx',cli,...args],{cwd:repo,encoding:'utf8',timeout:10000});}

it.each([green,cs2])('exports a decoded code pack with verified artifacts (%s)',async code=>{
 const output=join(directory,'pack');
 const result=run('--code',code,'--size','64','--scale','2','--output',output);
 expect(result.status,result.stderr).toBe(0);
 const names=await readdir(join(output,'crosshairs'));
 expect(names).toHaveLength(1); expect(names[0]).toMatch(/^aimloom_[a-f0-9]{32}\.png$/);
 const png=PNG.sync.read(await readFile(join(output,'crosshairs',names[0]!)));
 const expected=renderCrosshair(parseCrosshair(code),{size:64,scale:2});
 expect([png.width,png.height]).toEqual([64,64]); expect([...png.data]).toEqual([...expected.data]);
 expect([...png.data.subarray(0,4)]).toEqual([0,0,0,0]);
 if(code===green) expect([...png.data.subarray((31*64+36)*4,(31*64+36)*4+4)]).toEqual([0,255,0,255]);
 const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
 expect(manifest.source).toEqual({kind:'code',game:parseCrosshair(code).game,code,sha256:hash(code)});
 expect(manifest.render).toEqual({width:64,height:64,size:64,scale:2,profile:'primary'});
 expect(manifest.gameValidation).toBe('not_run'); expect(manifest.warnings).toEqual(expected.warnings);
 for(const warning of expected.warnings) expect(result.stderr).toContain(warning.code);
 for(const [path,entry] of Object.entries(manifest.artifacts) as [string,{bytes:number;sha256:string}][]){
  const bytes=await readFile(join(output,path)); expect(bytes.length).toBe(entry.bytes);expect(hash(bytes)).toBe(entry.sha256);
 }
 expect(Object.keys(manifest.artifacts).sort()).toEqual([`crosshairs/${names[0]}`,'preview.svg','START_HERE.txt','THIRD_PARTY_NOTICES.md'].sort());
 const sums=(await readFile(join(output,'SHA256SUMS.txt'),'utf8')).trim().split('\n');expect(sums).toHaveLength(5);
 for(const line of sums){const [sha,path]=line.split('  ');expect(hash(await readFile(join(output,path!)))).toBe(sha);}
 expect(await readFile(join(output,'THIRD_PARTY_NOTICES.md'))).toEqual(await readFile(join(repo,'THIRD_PARTY_NOTICES.md')));
 const instructions=await readFile(join(output,'START_HERE.txt'));expect([...instructions.subarray(0,3)]).toEqual([239,187,191]);
 expect(instructions.toString()).toContain('FFFFFF');expect(instructions.toString()).toContain('安装');
 expect(await readdir(output)).toHaveLength(6);
});
it('preserves imported pixels, dimensions and original source; never leaks input path',async()=>{
 const input=join(directory,'CON weird source.png'), output=join(directory,'pack');
 const png=new PNG({width:2,height:1});png.data=Buffer.from([30,60,90,120,255,3,8,0]);const bytes=PNG.sync.write(png);await writeFile(input,bytes);
 const result=run('--input',input,'--output',output);expect(result.status,result.stderr).toBe(0);
 const name=(await readdir(join(output,'crosshairs')))[0]!;
 expect([...PNG.sync.read(await readFile(join(output,'crosshairs',name))).data]).toEqual([...png.data]);
 expect(await readFile(input)).toEqual(bytes);
 const text=await readFile(join(output,'manifest.json'),'utf8');expect(text).not.toContain(input);expect(text).not.toContain('CON');
 expect(JSON.parse(text).source).toEqual({kind:'png',sha256:hash(bytes)});expect(JSON.parse(text).render).toEqual({width:2,height:1});
});
it('refuses an existing directory without changing its contents',async()=>{
 const output=join(directory,'keep');await mkdir(output);await writeFile(join(output,'user.txt'),'original');
 const result=run('--code',green,'--output',output);expect(result.status).toBe(1);expect(result.stderr).toContain('OUTPUT_EXISTS');
 expect(await readdir(output)).toEqual(['user.txt']);expect(await readFile(join(output,'user.txt'),'utf8')).toBe('original');
});
it.each([['--code','bad'],['--code',green,'--size','513'],['--code',green,'--scale','NaN'],['--code',green,'--profile','sniper'],['--code',green,'--code',green],['--code',green,'--name','../../bad'],['--input','missing.png'],['--code',green,'--input','x']])('rejects invalid arguments without destination (%j)',async (...args)=>{
 const output=join(directory,'absent');const result=run(...args,'--output',output);expect(result.status).toBe(1);expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');await expect(access(output)).rejects.toThrow();
});
it('rejects corrupt or oversized PNGs and PNG render overrides before output creation',async()=>{
 const input=join(directory,'bad.png');
 for(const bytes of [Buffer.from('bad PNG'),Buffer.alloc(2*1024*1024+1)]){await writeFile(input,bytes);const result=run('--input',input,'--output',join(directory,'absent'));expect(result.status).toBe(1);expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');}
 const png=new PNG({width:1,height:1});await writeFile(input,PNG.sync.write(png));
 const result=run('--input',input,'--scale','2','--output',join(directory,'absent'));expect(result.stderr).toContain('INVALID_VALUE');await expect(access(join(directory,'absent'))).rejects.toThrow();
});
it('resolves npm workspace relative output against repository root',async()=>{
 const output=join(directory,'relative');const args=['run','crosshair:pack','--','--code',green,'--output',relative(repo,output)];
 const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:repo,encoding:'utf8',timeout:10000,shell:process.platform==='win32'});
 expect(result.status,result.stderr).toBe(0);await expect(access(join(output,'manifest.json'))).resolves.toBeUndefined();
});
it('keeps staged PNGs invisible to native scanning when publication is interrupted',async()=>{
 const output=join(directory,'interrupted'), preload=join(directory,'fail-publication.mjs');
 // Inject an OS-boundary rename failure in a real subprocess; all rendering/writes remain real.
 await writeFile(preload,`import fs from 'node:fs/promises';
 import { syncBuiltinESMExports } from 'node:module';
 fs.rename=async()=>{throw Object.assign(new Error('simulated publication failure'),{code:'EIO'});}; syncBuiltinESMExports();`);
 const result=spawnSync(process.execPath,['--import',preload,'--import','tsx',cli,'--code',green,'--output',output],{cwd:repo,encoding:'utf8',timeout:10000});
 expect(result.status).toBe(1);expect(result.stderr).toContain('IO_ERROR');
 await expect(access(join(output,'crosshairs'))).rejects.toThrow();
 const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
 const staging=(await readdir(output)).find(name=>name.startsWith('.aimloom-staging-'))!;
 const pngPath=Object.keys(manifest.artifacts).find(path=>path.startsWith('crosshairs/'))!;
 expect(hash(await readFile(join(output,staging,pngPath)))).toBe(manifest.artifacts[pngPath].sha256);
 expect(run('--code',green,'--output',output).stderr).toContain('OUTPUT_EXISTS');
});
it('uses unique filenames across otherwise identical exports',async()=>{
 const names:string[]=[];
 for(const folder of ['one','two']){const output=join(directory,folder);expect(run('--code',green,'--output',output).status).toBe(0);names.push((await readdir(join(output,'crosshairs')))[0]!);}
 expect(new Set(names).size).toBe(2);
});

it('allows only one concurrent writer to reserve the requested folder',async()=>{
 const output=join(directory,'shared');
 function start():Promise<{code:number|null;stderr:string}>{return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',cli,'--code',green,'--output',output],{cwd:repo});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
 });}
 const results=await Promise.all([start(),start()]);expect(results.map(r=>r.code).sort()).toEqual([0,1]);
 expect(results.find(r=>r.code===1)!.stderr).toContain('OUTPUT_EXISTS');
 expect(await readdir(join(output,'crosshairs'))).toHaveLength(1);
 expect(await readdir(output)).toHaveLength(6);
});
