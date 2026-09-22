import { it, expect } from 'vitest'
import { createDemoBridge } from '../../src/installer/demo-bridge'
it('the demonstration restores original personal settings rather than deleting them', async()=>{
 const bridge=createDemoBridge({durationMs:0})
 const found=await bridge.discover()
 const gameRoot=found.candidates[0]!
 const plan=await bridge.planInstall({gameRoot,packRoot:found.defaultPack!,categories:['primary'],revision:0})
 expect(plan.rows[0]?.action).toBe('replace')
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
 // Planning adds nothing: Scheme still shows only what the game had.
 expect((await bridge.schemeList(gameRoot)).themes.map(t=>t.file)).not.toContain('Blue-room.json')
 await bridge.execute({operationId:'import-theme',planId:plan.planId,confirmation:'install',allowConflicts:false})
 expect((await bridge.schemeList(gameRoot)).themes.map(t=>t.file)).toContain('Blue-room.json')
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
