import { expect, it } from 'vitest';
import { CROSSHAIR_GAMES, previewCrosshairCode, CrosshairError } from '../src/index';
import { previewCrosshair, prepareCrosshairReplacement } from '../src/service';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const codes={cs2:'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG',valorant:'0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0'};
it('exposes the two explicit game choices',()=>{
 expect(CROSSHAIR_GAMES).toEqual([{id:'cs2',label:'CS2'},{id:'valorant',label:'VALORANT'}]);
});
it.each(['cs2','valorant'] as const)('renders selected %s code as deterministic static pixels and SVG',game=>{
 const p=previewCrosshairCode(game,codes[game]);
 expect(p.game).toBe(game);expect(p.mode).toBe('static');expect(p.svg).toContain('<svg');
 expect(p.raster.data.some((v,i)=>i%4===3&&v>0)).toBe(true);
 expect(previewCrosshairCode(game,codes[game]).raster.data).toEqual(p.raster.data);
 const node=previewCrosshair({kind:'code',game,code:codes[game]});
 expect(node.source.game).toBe(game);expect(node.raster.data).toEqual(p.raster.data);
 if(game==='cs2')expect(p.warnings.some(w=>w.code==='STATIC_APPROXIMATION')).toBe(true);
});
it.each(['cs2','valorant'] as const)('does not silently switch away from selected %s',game=>{
 const wrong=codes[game==='cs2'?'valorant':'cs2'];
 expect(()=>previewCrosshairCode(game,wrong)).toThrow(CrosshairError);
 expect(()=>previewCrosshair({kind:'code',game,code:wrong})).toThrow(CrosshairError);
});
it('rejects unknown game and empty code',()=>{
 expect(()=>previewCrosshairCode('auto' as never,codes.cs2)).toThrow(CrosshairError);
 expect(()=>previewCrosshair({kind:'code',game:'other' as never,code:codes.cs2})).toThrow(CrosshairError);
 expect(()=>previewCrosshairCode('valorant','')).toThrow(CrosshairError);
});
it('does not prepare replacement files for code of the wrong game',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crosshair-game-'));
 try{
  await expect(prepareCrosshairReplacement({kind:'code',game:'cs2',code:codes.valorant},{outputDirectory:join(root,'out'),targetFileName:'aim.png'})).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
