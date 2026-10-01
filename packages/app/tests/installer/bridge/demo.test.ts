import { it, expect } from 'vitest'
import { createDemoBridge } from '../../../src/bridge/demo'
it('the demonstration restores original personal settings rather than deleting them', async()=>{
 const bridge=createDemoBridge({durationMs:0})
 const found=await bridge.discover()
 const gameRoot=found.candidates[0]!
 const plan=await bridge.planImport({gameRoot,paths:[found.defaultPack!],includeSettings:true,revision:0})
 expect(plan.rows.find(r=>r.category==='primary')?.action).toBe('replace')
 await bridge.execute({operationId:'test-install',planId:plan.planId,confirmation:'install',allowConflicts:false})
 const restore=await bridge.planRestore({gameRoot,sourceId:'pristine',revision:0})
 expect(restore.rows.find(r=>r.category==='primary')?.action).toBe('restore')
})
it('an imported theme or sound joins the listings only after its job completes', async()=>{
 const bridge=createDemoBridge({durationMs:0})
 const gameRoot=(await bridge.discover()).candidates[0]!
 const source=(await bridge.pickFile('theme', 'zh'))!
 const plan=await bridge.planFileAdd({gameRoot,kind:'theme',sourcePath:source,sourceSha256:'a'.repeat(64),file:'Blue-room.json',revision:0})
 expect(plan.rows).toHaveLength(1)
 expect(plan.rows[0]).toMatchObject({key:'themes/Blue-room.json',action:'create'})
 // Planning adds nothing: Theme still shows only what the game had.
 expect((await bridge.themeList(gameRoot)).themes.map(t=>t.file)).not.toContain('Blue-room.json')
 await bridge.execute({operationId:'import-theme',planId:plan.planId,confirmation:'install',allowConflicts:false})
 expect((await bridge.themeList(gameRoot)).themes.map(t=>t.file)).toContain('Blue-room.json')
 // Never overwrite: the same name is refused, whatever the letter case.
 await expect(bridge.planFileAdd({gameRoot,kind:'theme',sourcePath:source,sourceSha256:'a'.repeat(64),file:'BLUE-ROOM.json',revision:1})).rejects.toThrow(/已经有/)
 const sound=await bridge.planFileAdd({gameRoot,kind:'sound',sourcePath:(await bridge.pickFile('sound', 'zh'))!,sourceSha256:'a'.repeat(64),file:'Soft-hit.wav',revision:2})
 await bridge.execute({operationId:'import-sound',planId:sound.planId,confirmation:'install',allowConflicts:false})
 expect((await bridge.audioList(gameRoot)).sounds.map(s=>s.name)).toContain('Soft-hit')
})
it('the demo enemy skin state starts fixed and only changes once a plan is executed', async()=>{
 const bridge=createDemoBridge({durationMs:0})
 const gameRoot=(await bridge.discover()).candidates[0]!
 const before=await bridge.enemyList(gameRoot)
 expect(before.skins).toHaveLength(15)
 expect(before.current.cylindrical).toEqual({model:'Stylized Ecto',skin:'Default'})
 // A pair not in the catalog for the shape is refused, and nothing changes.
 await expect(bridge.planEnemy({gameRoot,shape:'cylindrical',model:'No Such Model',skin:'Default',revision:0})).rejects.toThrow()
 // The pair already equipped is refused too.
 await expect(bridge.planEnemy({gameRoot,shape:'cylindrical',model:'Stylized Ecto',skin:'Default',revision:0})).rejects.toThrow()
 const plan=await bridge.planEnemy({gameRoot,shape:'cylindrical',model:'Ghost',skin:'Default',revision:1})
 expect((await bridge.enemyList(gameRoot)).current.cylindrical).toEqual({model:'Stylized Ecto',skin:'Default'})
 await bridge.execute({operationId:'enemy-skin',planId:plan.planId,confirmation:'install',allowConflicts:false})
 expect((await bridge.enemyList(gameRoot)).current.cylindrical).toEqual({model:'Ghost',skin:'Default'})
})
it('the demo Quick import adds new files, skips what the game has and plans settings only on request', async()=>{
 const bridge=createDemoBridge({durationMs:0})
 const found=await bridge.discover()
 const gameRoot=found.candidates[0]!
 const pack=found.defaultPack!
 const plan=await bridge.planImport({gameRoot,paths:[pack,'C:\\Users\\Player1\\Downloads\\pack.zip','C:\\Users\\Player1\\Downloads\\Soft.wav'],includeSettings:false,revision:0})
 const reasons=Object.fromEntries(plan.rows.map(r=>[r.key,r.action==='skip'?r.reason:r.action]))
 expect(reasons).toMatchObject({'themes/Clean Dark.json':'exists-same','themes/Aimloom Demo.json':'create','sounds/Bell5.ogg':'sound-stem-taken',
  'crosshairs/dot.png':'exists-same','sounds/Soft.wav':'create','primary/PrimaryUserSettings.json':'settings-not-included'})
 expect(plan.skipped).toContain('C:\\Users\\Player1\\Downloads\\pack.zip')
 expect(plan.packRoot).toBeNull()
 expect(plan.rows.some(r=>r.action==='replace')).toBe(false)
 await bridge.execute({operationId:'quick-import',planId:plan.planId,confirmation:'install',allowConflicts:false})
 expect((await bridge.themeList(gameRoot)).themes.map(t=>t.file)).toContain('Aimloom Demo.json')
 const again=await bridge.planImport({gameRoot,paths:[pack],includeSettings:true,revision:1})
 expect(again.rows.find(r=>r.key==='themes/Aimloom Demo.json')?.reason).toBe('exists-different')
 expect(again.rows.find(r=>r.key==='primary/PrimaryUserSettings.json')?.action).toBe('replace')
})
