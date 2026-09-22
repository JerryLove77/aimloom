import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { previewCrosshair, prepareCrosshairReplacement } from '../src/service';
const code='0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0';
const roots:string[]=[];
async function temp(){const p=await mkdtemp(join(tmpdir(),'crosshair-service-'));roots.push(p);return p;}
afterEach(async()=>{for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
it('previews code into matching PNG/SVG without filesystem writes',()=>{
 const p=previewCrosshair({kind:'code',code,options:{scale:2}});
 const image=PNG.sync.read(Buffer.from(p.png));
 expect([p.width,p.height]).toEqual([128,128]);expect(image.data).toEqual(Buffer.from(p.raster.data));
 expect(p.svg).toContain('<svg');expect(p.source.game).toBe('valorant');
 expect(p.sha256).toBe(createHash('sha256').update(p.png).digest('hex'));
});
it('previews imported alpha pixels without mutating input',()=>{
 const png=new PNG({width:2,height:1});png.data=Buffer.from([1,2,3,120,4,5,6,0]);
 const bytes=PNG.sync.write(png),copy=Buffer.from(bytes);
 const p=previewCrosshair({kind:'png',bytes});
 expect([...p.raster.data]).toEqual([...png.data]);expect(bytes).toEqual(copy);
 expect([p.width,p.height]).toEqual([2,1]);
});
it('preserves CS2 warnings',()=>{
 const p=previewCrosshair({kind:'code',code:'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG'});
 expect(p.warnings.some(w=>w.code==='STATIC_APPROXIMATION')).toBe(true);
});
it('rejects corrupt PNG and PNG render overrides',()=>{
 expect(()=>previewCrosshair({kind:'png',bytes:Buffer.from('bad')})).toThrow();
 expect(()=>previewCrosshair({kind:'png',bytes:Buffer.from('bad'),options:{scale:2}} as never)).toThrow();
});
it('prepares one explicitly named asset and pinned preview metadata',async()=>{
 const root=await temp(),output=join(root,'replacement');
 const result=await prepareCrosshairReplacement({kind:'code',code},{outputDirectory:output,targetFileName:'My-crosshair.png'});
 expect(result.targetFileName).toBe('My-crosshair.png');expect(result.requiresConfirmation).toBe(true);
 expect(await readdir(join(output,'crosshairs'))).toEqual(['My-crosshair.png']);
 const m=JSON.parse(await readFile(join(output,'crosshair-replacement.json'),'utf8'));
 expect(m.kind).toBe('crosshair-replacement');expect(m.png.sha256).toBe(result.sha256);
 expect(m.png.file).toBe('crosshairs/My-crosshair.png');expect(m.gameSelectionChanged).toBe(false);
 expect(createHash('sha256').update(await readFile(join(output,m.png.file))).digest('hex')).toBe(m.png.sha256);
 expect(await readFile(join(output,'preview.svg'),'utf8')).toContain('<svg');
 expect(await readFile(join(output,'THIRD_PARTY_NOTICES.md'),'utf8')).toContain('MIT');
 await writeFile(join(output,'keep'),'user');
 await expect(prepareCrosshairReplacement({kind:'code',code},{outputDirectory:output,targetFileName:'My-crosshair.png'})).rejects.toThrow();
 expect(await readFile(join(output,'keep'),'utf8')).toBe('user');
});
it.each(['../x.png','C:\\x.png','CON.png','CON.any.png','file.png:stream','x.jpg','x.png.','x?.png'])('rejects unsafe target %s before creating output',async targetFileName=>{
 const root=await temp(),output=join(root,'out');
 await expect(prepareCrosshairReplacement({kind:'code',code},{outputDirectory:output,targetFileName})).rejects.toThrow();
 expect(await readdir(root)).toEqual([]);
});
it('invalid source leaves no replacement directory',async()=>{
 const root=await temp();
 await expect(prepareCrosshairReplacement({kind:'code',code:'bad'},{outputDirectory:join(root,'out'),targetFileName:'ok.png'})).rejects.toThrow();
 expect(await readdir(root)).toEqual([]);
});
it('snapshots validated filename and render options before awaiting filesystem work',async()=>{
 const root=await temp(),output=join(root,'out');
 const request={outputDirectory:output,targetFileName:'safe.png'};
 const input={kind:'code' as const,code,options:{scale:1}};
 const pending=prepareCrosshairReplacement(input,request);
 request.targetFileName='../../escaped.png';input.options.scale=3;
 const result=await pending;
 expect(result.targetFileName).toBe('safe.png');
 expect(await readdir(root)).toEqual(['out']);
 expect(await readdir(join(output,'crosshairs'))).toEqual(['safe.png']);
 const m=JSON.parse(await readFile(join(output,'crosshair-replacement.json'),'utf8'));
 expect(m.options.scale).toBe(1);
});
