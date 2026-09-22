import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';

const repo=fileURLToPath(new URL('../../..',import.meta.url));
const cli=fileURLToPath(new URL('../cli/prepare-test-kit.ts',import.meta.url));
let temp:string;
beforeEach(async()=>{temp=await mkdtemp(join(tmpdir(),'aimloom-kit-test-'));});
afterEach(async()=>{await rm(temp,{recursive:true,force:true});});
function run(...args:string[]) {
  return spawnSync(process.execPath,['--import','tsx',cli,...args],{cwd:repo,encoding:'utf8',timeout:10000});
}
type Entry={id:string; code:string; options:{size:number;scale:number}; png:{file:string;sha256:string;bytes:number}; svg:{file:string;sha256:string}; warnings:{code:string}[]};
type Manifest={schemaVersion:number;kitId:string;rendererSourcesSha256:string;cases:Entry[];supportFiles:{file:string;sha256:string;bytes:number}[]};
async function prepare(folder='kit') {
  const output=join(temp,folder);
  const result=run('--output',output);
  expect(result.status,result.stderr).toBe(0);
  return {output,manifest:JSON.parse(await readFile(join(output,'manifest.json'),'utf8')) as Manifest};
}
const pixel=(png:PNG,x:number,y:number)=>[...png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];

describe('hardware test kit preparation',()=>{
  it('packages six unscaled cases with matching asset hashes and provenance',async()=>{
    const {output,manifest}=await prepare();
    expect(manifest.cases.map(c=>c.id)).toEqual(['simple-cross','center-dot','outlined-cross','half-alpha','t-style','odd-thickness']);
    expect(manifest.rendererSourcesSha256).toMatch(/^[0-9a-f]{64}$/);
    for(const item of manifest.cases) {
      expect(item.options).toEqual({size:128,scale:1});
      expect(item.png.file).toMatch(/^crosshairs\/aimloom_test_[a-f0-9]+_[a-z-]+\.png$/);
      for(const artifact of [item.png,item.svg]) {
        const bytes=await readFile(join(output,artifact.file));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
      }
      const bytes=await readFile(join(output,item.png.file));
      expect(bytes.length).toBe(item.png.bytes);
      const png=PNG.sync.read(bytes);
      expect([png.width,png.height]).toEqual([128,128]);
      expect(pixel(png,0,0)).toEqual([0,0,0,0]);
      expect(item.code.length).toBeGreaterThan(0);
    }
    expect(manifest.cases.find(c=>c.id==='t-style')!.warnings.map(w=>w.code)).toContain('STATIC_APPROXIMATION');
    expect((await readdir(output)).sort()).toEqual(['Run-Test.cmd','Crosshair-Test.ps1','Crosshair-Test.Core.ps1','KOVAAK_TEST.md','SHA256SUMS.txt','THIRD_PARTY_NOTICES.md','crosshairs','manifest.json','previews','results.json'].sort());
  });

  it('preserves helper bytes and publishes matching checksums',async()=>{
    const {output,manifest}=await prepare();
    expect(manifest.supportFiles.map(f=>f.file)).toEqual(['Run-Test.cmd','Crosshair-Test.ps1','Crosshair-Test.Core.ps1']);
    const sums=await readFile(join(output,'SHA256SUMS.txt'),'utf8');
    for(const file of manifest.supportFiles){
      const bytes=await readFile(join(output,file.file));
      expect(bytes).toEqual(await readFile(join(repo,'packages/crosshair/qa/windows',file.file)));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(sums).toContain(`${file.sha256}  ${file.file}`);
    }
  });

  it('produces the intended dot, opacity, outline and T-shape pixels',async()=>{
    const {output,manifest}=await prepare();
    const get=async(id:string)=>PNG.sync.read(await readFile(join(output,manifest.cases.find(c=>c.id===id)!.png.file)));
    expect(pixel(await get('simple-cross'),66,63)).toEqual([0,255,0,255]);
    expect(pixel(await get('center-dot'),63,63)).toEqual([255,255,255,255]);
    expect(pixel(await get('outlined-cross'),57,63)).toEqual([0,0,0,255]);
    expect(pixel(await get('half-alpha'),66,63)).toEqual([255,153,255,128]);
    expect(pixel(await get('t-style'),64,54)[3]).toBe(0);
    expect(pixel(await get('t-style'),64,70)[3]).toBeGreaterThan(0);
    expect(pixel(await get('odd-thickness'),66,63)[3]).toBe(128);
  });

  it('keeps every game result unexecuted and records missing environment details',async()=>{
    const {output,manifest}=await prepare();
    const results=JSON.parse(await readFile(join(output,'results.json'),'utf8')) as {
      kitId:string;environment:{gameBuild:null;resolution:null};sourceGameCalibration:string;cases:{id:string;checks:Record<string,string>}[];
    };
    expect(results.kitId).toBe(manifest.kitId);
    expect(results.environment.gameBuild).toBeNull();
    expect(results.environment.resolution).toBeNull();
    expect(results.sourceGameCalibration).toBe('deferred_source_game_unavailable');
    expect(results.cases.map(c=>c.id)).toEqual(manifest.cases.map(c=>c.id));
    for(const item of results.cases) expect(Object.values(item.checks)).toEqual(Array(6).fill('not_run'));
  });

  it('refuses an existing destination without overwriting or adding anything',async()=>{
    const output=join(temp,'owned');await mkdir(output);await writeFile(join(output,'keep.txt'),'user data');
    const result=run('--output',output);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OUTPUT_EXISTS');
    expect(await readFile(join(output,'keep.txt'),'utf8')).toBe('user data');
    expect(await readdir(output)).toEqual(['keep.txt']);
  });

  it('uses distinct asset filenames for independently prepared kits',async()=>{
    const first=await prepare('one'),second=await prepare('two');
    expect(first.manifest.kitId).not.toBe(second.manifest.kitId);
    const filenames=new Set(first.manifest.cases.map(c=>c.png.file));
    expect(second.manifest.cases.some(c=>filenames.has(c.png.file))).toBe(false);
  });

  it('rejects malformed arguments before creating a directory',async()=>{
    const output=join(temp,'absent');
    expect(run('--output',output,'--unknown').status).not.toBe(0);
    await expect(readdir(output)).rejects.toThrow();
  });

  it('resolves relative output from the repo even when npm runs in the workspace',async()=>{
    const relativeOutput=`dist/crosshair-kit-relative-${randomUUID()}`;
    const expected=join(repo,relativeOutput),workspaceOutput=join(repo,'packages','crosshair',relativeOutput);
    try {
      const result=spawnSync(process.execPath,['--import','tsx',cli,'--output',relativeOutput],
        {cwd:join(repo,'packages','crosshair'),encoding:'utf8',timeout:10000});
      expect(result.status,result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).output).toBe(expected);
      expect(JSON.parse(await readFile(join(expected,'manifest.json'),'utf8')).cases).toHaveLength(6);
    } finally {
      await rm(expected,{recursive:true,force:true});
      await rm(workspaceOutput,{recursive:true,force:true});
    }
  });
});

describe('size calibration kit',()=>{
  it('renders nine centered, unclipped variants with measured alpha bounds and unchanged source codes',async()=>{
    const output=join(temp,'calibration');
    const result=run('--calibration','--output',output);
    expect(result.status,result.stderr).toBe(0);
    const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
    const fixtures=JSON.parse(await readFile(join(repo,'packages/crosshair/qa/game-cases.json'),'utf8'));
    expect(manifest.purpose).toBe('size-calibration');
    expect(manifest.cases).toHaveLength(9);
    for(const baseCase of ['simple-cross','center-dot','odd-thickness']){
      const entries=manifest.cases.filter((c:any)=>c.baseCase===baseCase);
      expect(entries.map((c:any)=>c.options.scale)).toEqual([1,2,3]);
      const widths=[];
      for(const entry of entries){
        expect(entry.code).toBe(fixtures.find((f:any)=>f.id===baseCase).code);
        expect(entry.png.file).toMatch(/^crosshairs\/aimloom_test_[a-f0-9]{12}_[a-z-]+\.png$/);
        const bytes=await readFile(join(output,entry.png.file));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.png.sha256);
        const png=PNG.sync.read(bytes);expect([png.width,png.height]).toEqual([128,128]);
        const xs:number[]=[],ys:number[]=[];
        for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(png.data[(y*128+x)*4+3]){xs.push(x);ys.push(y);}
        const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
        expect(entry.pixelBounds).toEqual({x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1});
        expect(minX+maxX).toBe(127);expect(minY+maxY).toBe(127);
        expect(minX).toBeGreaterThan(0);expect(maxX).toBeLessThan(127);
        expect(minY).toBeGreaterThan(0);expect(maxY).toBeLessThan(127);
        widths.push(maxX-minX+1);
        if(baseCase==='center-dot')expect(maxX-minX+1).toBe(2*entry.options.scale);
      }
      expect(widths[1]).toBeGreaterThan(widths[0]!);expect(widths[2]).toBeGreaterThan(widths[1]!);
    }
    const results=JSON.parse(await readFile(join(output,'results.json'),'utf8'));
    expect(results.cases).toHaveLength(9);
    expect(results.sizeDecision).toEqual({status:'not_run',preferredScales:{'simple-cross':null,'center-dot':null,'odd-thickness':null}});
    for(const entry of results.cases)expect(Object.values(entry.checks)).toEqual(Array(6).fill('not_run'));
    const guide=await readFile(join(output,'START_HERE.txt'));
    expect([...guide.subarray(0,3)]).toEqual([239,187,191]);
    expect(guide.toString('utf8')).toContain('9');
  });

  it('rejects duplicate calibration flags and preserves an existing destination',async()=>{
    const output=join(temp,'calibration');
    expect(run('--calibration','--calibration','--output',output).status).not.toBe(0);
    await expect(readdir(output)).rejects.toThrow();
    await mkdir(output);await writeFile(join(output,'keep.txt'),'keep');
    const r=run('--calibration','--output',output);
    expect(r.status).not.toBe(0);expect(r.stderr).toContain('OUTPUT_EXISTS');
    expect(await readdir(output)).toEqual(['keep.txt']);
  });
});

it('keeps an interrupted calibration kit invisible to the native asset scanner',async()=>{
  const output=join(temp,'interrupted'),preload=join(temp,'failure.mjs');
  await writeFile(preload,`import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
fs.rename=async()=>{throw Object.assign(new Error('injected publish failure'),{code:'EIO'});};syncBuiltinESMExports();`);
  const result=spawnSync(process.execPath,['--import',preload,'--import','tsx',cli,'--calibration','--output',output],{cwd:repo,encoding:'utf8',timeout:10000});
  expect(result.status).toBe(1);
  await expect(readdir(join(output,'crosshairs'))).rejects.toThrow();
  expect(await readdir(join(output,'.crosshairs-staging'))).toHaveLength(9);
  expect(JSON.parse(await readFile(join(output,'manifest.json'),'utf8')).cases).toHaveLength(9);
});
