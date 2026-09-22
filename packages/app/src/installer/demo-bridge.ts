import { localIssue } from './issue'
import demoData from './demo-data.json'
import { InstallerFailure, type Backup, type Category, type EnemyShape, type EnemySkin, type EnemySkinChoice, type FileRow, type InstallerBridge, type Job, type Location, type Preview, type SchemeTheme } from './contracts'
const gameRoot='D:\\SteamLibrary\\steamapps\\common\\FPSAimTrainer'
const packRoot='C:\\Users\\Player\\Downloads\\KVK Settings 2025'
const categories:Category[]=['themes','sounds','crosshairs','ui','palette','primary']
const counts:Record<Category,number>={themes:139,sounds:480,crosshairs:73,ui:1,palette:1,primary:1}
const labels:Record<Category,string[]>={themes:['clover-alternate.json','Clean Dark.json','snowi clarity.json'],sounds:['Bell5.ogg','Q3Railgun.wav',demoData.chineseSound],crosshairs:['dot.png','01_plus.png',demoData.chineseCrosshair],ui:['UI.json'],palette:['Palette.ini'],primary:['PrimaryUserSettings.json']}
const clone=<T,>(v:T):T=>structuredClone(v)
// The game's own Skin Browser catalog (docs/research/kovaak-skin-browser.md), for the demo
// only: the real catalog's single source is the engine (scripts/installer/kvk-enemy.ps1).
const enemySkinCatalog:EnemySkin[]=[
  {label:'None',model:'None',skin:'None',shapes:['cylindrical','cuboid','spheroid']},
  {label:'Ghost',model:'Ghost',skin:'Default',shapes:['cylindrical','cuboid','spheroid']},
  {label:'Mummy',model:'Mummy',skin:'Default',shapes:['cylindrical','cuboid','spheroid']},
  {label:'Stylized',model:'Stylized Ecto',skin:'Default',shapes:['cylindrical']},
  {label:'Ecto',model:'Ecto',skin:'Default',shapes:['cylindrical']},
  {label:'Endo',model:'Endo',skin:'Default',shapes:['cylindrical']},
  {label:'Meso',model:'Meso',skin:'Default',shapes:['cylindrical']},
  {label:'Shinji',model:'Meso',skin:'Genji',shapes:['cylindrical']},
  {label:'McCoy',model:'Meso',skin:'McCree',shapes:['cylindrical']},
  {label:'Rocket Flyer',model:'Meso',skin:'Pharah',shapes:['cylindrical']},
  {label:'Racer',model:'Meso',skin:'Tracer',shapes:['cylindrical']},
  {label:'Swat Arya',model:'Anime Girl',skin:'Default',shapes:['cylindrical']},
  {label:'Swat Katsumi',model:'Anime Girl',skin:'Katsumi - SWAT',shapes:['cylindrical']},
  {label:'School Arya',model:'Anime Girl',skin:'Arya - School',shapes:['cylindrical']},
  {label:'School Katsumi',model:'Anime Girl',skin:'Katsumi - School',shapes:['cylindrical']},
]
const error=(code:ConstructorParameters<typeof InstallerFailure>[0]['code'],key:Parameters<typeof localIssue>[1],params?:Parameters<typeof localIssue>[2])=>new InstallerFailure(localIssue(code,key,params))
export function createDemoBridge(options:{durationMs?:number}={}):InstallerBridge {
  let currentPlan:Preview|null=null
  let sequence=0
  const records:Backup[]=[]
  const original=new Map<string,FileRow>()
  for(const category of ['ui','palette','primary'] as Category[]){
    const name=labels[category][0]!
    original.set(`${category}/${name}`,{key:`${category}/${name}`,category,source:null,target:`${gameRoot}\\FPSAimTrainer\\Saved\\SaveGames\\${name}`,action:'restore',conflict:false,unowned:false})
  }
  const installed=new Map<string,FileRow>(original)
  const snapshots=new Map<string,Map<string,FileRow>>()
  const jobs=new Map<string,{job:Job;plan:Preview;start:number;applied:boolean}>()
  // Files a demo import added, so the listings show them once the job completes.
  const imports=new Map<string,{kind:'theme'|'sound';file:string}>()
  const added={theme:[] as string[],sound:[] as string[]}
  // The demo's equipped skin per shape, and a change planned but not yet applied.
  let enemyState:Record<EnemyShape,EnemySkinChoice|null>={
    cylindrical:{model:'Stylized Ecto',skin:'Default'},cuboid:{model:'Ghost',skin:'Default'},spheroid:{model:'Mummy',skin:'Default'},
  }
  const pendingEnemy=new Map<string,{shape:EnemyShape;choice:EnemySkinChoice}>()
  const duration=options.durationMs??1800
  const location=(root:string):Location=>({gameRoot:root,backupRoot:'C:\\Users\\Player\\AppData\\Local\\Aimloom\\backups\\demo',gameState:'closed'})
  function complete(entry:typeof jobs extends Map<string,infer V>?V:never):Job {
    const {job,plan}=entry
    if(entry.applied)return clone(job)
    const elapsed=Date.now()-entry.start
    if(elapsed<duration){
      const fraction=elapsed/duration
      job.progress={phase:plan.kind==='restore'?'restoring':fraction<.25?'preparing':fraction<.5?'protecting':'installing',completed:Math.floor(plan.rows.length*fraction),total:plan.rows.length,currentFile:plan.rows[Math.min(plan.rows.length-1,Math.floor(plan.rows.length*fraction))]?.target??null,batchId:null}
      return clone(job)
    }
    entry.applied=true
    const imported=imports.get(plan.planId)
    if(imported&&!added[imported.kind].includes(imported.file))added[imported.kind].push(imported.file)
    const enemyChange=pendingEnemy.get(plan.planId)
    if(enemyChange)enemyState={...enemyState,[enemyChange.shape]:enemyChange.choice}
    const id=`demo-batch-${++sequence}`
    if(plan.kind==='install'){
      snapshots.set(id,new Map(installed))
      for(const row of plan.rows)if(row.action!=='skip')installed.set(row.key,clone(row))
    }else{
      const target=plan.sourceId==='pristine'?original:snapshots.get(plan.sourceId??'')
      if(target){installed.clear();for(const [key,row]of target)installed.set(key,clone(row))}
      for(const record of records)if(plan.sourceId==='pristine'||record.id===plan.sourceId)record.status='rolled-back'
    }
    const noChange=plan.rows.every(row=>row.action==='skip')
    if(!noChange)records.unshift({id,createdAt:new Date().toISOString(),kind:plan.kind,status:'completed',categories:clone(plan.categories),fileCount:plan.rows.filter(r=>r.action!=='skip').length})
    job.state='finished';job.progress=null
    job.result={status:plan.kind==='restore'?'restored':noChange?'no-change':'completed',batchId:noChange?null:id,items:plan.rows.map(r=>({key:r.key,target:r.target,state:r.action==='skip'?'skip':plan.kind==='restore'?'restored':'applied'})),errors:[],errorsEn:[]}
    return clone(job)
  }
  const bridge:InstallerBridge={
    async discover(){return {candidates:[gameRoot],defaultPack:packRoot}},
    async locate(root){if(!root.trim())throw error('INVALID_PATH','installer.demo.selectGame');return location(root)},
    async catalog(root){if(!root.trim())throw error('INVALID_PACK','installer.demo.selectPack');return {packRoot:root,categories:categories.map(category=>({category,count:counts[category]})),skipped:['sounds/Bell5.ogg.sfk','crosshairs/dot.png~']}},
    async backups(root){if(!root.trim())throw error('INVALID_PATH','installer.error.selectGameFirst');return {location:location(root),records:clone(records),hasPristine:records.length>0}},
    async gameState(){return 'closed'},
    async planInstall(input){
      if(!input.categories.length)throw error('INVALID_PACK','installer.demo.selectOne')
      const rows:FileRow[]=[]
      for(const category of input.categories){
        for(let i=0;i<counts[category];i++){
          const name=labels[category][i]??`${category}-${String(i+1).padStart(3,'0')}.${category==='themes'?'json':category==='sounds'?'ogg':'png'}`
          const folder=category==='themes'?'Saved\\SaveGames\\Themes':category==='ui'||category==='primary'?'Saved\\SaveGames':category
          const key=`${category}/${name}`
          const source=category==='ui'||category==='palette'||category==='primary'?`${input.packRoot}\\${name}`:`${input.packRoot}\\${category==='themes'?'Themes':category}\\${name}`
          rows.push({key,category,source,target:category==='palette'?`C:\\Users\\Player\\AppData\\Local\\FPSAimTrainer\\Saved\\Config\\WindowsNoEditor\\${name}`:`${input.gameRoot}\\FPSAimTrainer\\${folder}\\${name}`,action:installed.get(key)?.source===source?'skip':installed.has(key)?'replace':'create',conflict:false,unowned:false})
        }
      }
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:input.packRoot,categories:clone(input.categories),sourceId:null,rows,skipped:[]}
      return clone(currentPlan)
    },
    async schemeList(root){
      if(!root.trim())throw error('INVALID_PATH','installer.error.selectGameFirst')
      const folder=`${root}\\FPSAimTrainer\\Saved\\SaveGames\\Themes`
      const themes:SchemeTheme[]=['Clean Dark','snowi clarity','clover-alternate'].map(name=>({name,file:`${name}.json`,path:`${folder}\\${name}.json`,readable:true,duplicateName:false}))
      for(const file of added.theme)themes.push({name:file.replace(/\.json$/i,''),file,path:`${folder}\\${file}`,readable:true,duplicateName:false})
      themes.push({name:null,file:'Broken.json',path:`${folder}\\Broken.json`,readable:false,duplicateName:false})
      return {directory:folder,current:'Clean Dark',themes}
    },
    async planScheme(input){
      if(!input.file.endsWith('.json'))throw error('INVALID_PATH','installer.demo.invalidTheme')
      const target=`${input.gameRoot}\\FPSAimTrainer\\Saved\\SaveGames\\PrimaryUserSettings.json`
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:['primary'],sourceId:null,rows:[{key:'primary/PrimaryUserSettings.json',category:'primary',source:null,target,action:'replace',conflict:false,unowned:false}],skipped:[]}
      return clone(currentPlan)
    },
    async audioList(root){
      if(!root.trim())throw error('INVALID_PATH','installer.error.selectGameFirst')
      const folder=`${root}\\FPSAimTrainer\\sounds`
      const names=['Bell5','spawn05','saya_kick_deeper','hit','Twice','None']
      const sounds=names.map(name=>({name,file:`${name}.wav`,path:`${folder}\\${name}.wav`,ambiguous:name==='Twice'}))
      for(const file of added.sound)sounds.push({name:file.replace(/\.(wav|ogg)$/i,''),file,path:`${folder}\\${file}`,ambiguous:false})
      return {directory:folder,sounds,bindings:{kill:['saya_kick_deeper','Bell5'],spawn:[],mbsGood:['None'],mbsOkay:['None'],mbsBad:['None'],mbsChangeNow:['spawn05']}}
    },
    async planAudio(input){
      if(!input.names.length&&input.event!=='kill'&&input.event!=='spawn')throw error('ENGINE_ERROR','installer.demo.singleSound')
      const target=`${input.gameRoot}\\FPSAimTrainer\\Saved\\SaveGames\\PrimaryUserSettings.json`
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:['primary'],sourceId:null,rows:[{key:'primary/PrimaryUserSettings.json',category:'primary',source:null,target,action:'replace',conflict:false,unowned:false}],skipped:[]}
      return clone(currentPlan)
    },
    async crosshairList(root){
      if(!root.trim())throw error('INVALID_PATH','installer.error.selectGameFirst')
      const folder=`${root}\\FPSAimTrainer\\crosshairs`
      return {directory:folder,crosshairs:['aimloom_slot','dot','plus','circle'].map(name=>({name,file:`${name}.png`,path:`${folder}\\${name}.png`}))}
    },
    async enemyList(root){
      if(!root.trim())throw error('INVALID_PATH','installer.error.selectGameFirst')
      return {current:clone(enemyState),skins:clone(enemySkinCatalog)}
    },
    async planEnemy(input){
      const row=enemySkinCatalog.find(skin=>skin.model===input.model&&skin.skin===input.skin&&skin.shapes.includes(input.shape))
      if(!row)throw error('ENGINE_ERROR','installer.demo.enemySkinNotCataloged')
      const current=enemyState[input.shape]
      if(current&&current.model===input.model&&current.skin===input.skin)throw error('ENGINE_ERROR','installer.demo.enemySkinAlreadyEquipped')
      const target=`${input.gameRoot}\\FPSAimTrainer\\Saved\\SaveGames\\PrimaryUserSettings.json`
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:['primary'],sourceId:null,rows:[{key:'primary/PrimaryUserSettings.json',category:'primary',source:null,target,action:'replace',conflict:false,unowned:false}],skipped:[]}
      pendingEnemy.set(currentPlan.planId,{shape:input.shape,choice:{model:input.model,skin:input.skin}})
      return clone(currentPlan)
    },
    async planProfileApply(input){
      // The demo never holds a real Profile store; it only exercises the two paths the UI
      // needs to show: an ordinary one-row preview, and the refusal a missing reference causes.
      if(input.id==='missing-file-demo')throw error('ENGINE_ERROR','installer.demo.profileMissingFile')
      const target=`${input.gameRoot}\\FPSAimTrainer\\Saved\\SaveGames\\PrimaryUserSettings.json`
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:['primary'],sourceId:null,rows:[{key:'primary/PrimaryUserSettings.json',category:'primary',source:null,target,action:'replace',conflict:false,unowned:false}],skipped:[]}
      return clone(currentPlan)
    },
    async exportFile(input){
      // Browser demo: nothing is written; the result only describes what would be saved.
      if(!input.fileName.endsWith('.png'))throw error('INVALID_PATH','installer.demo.invalidFile')
      return {path:`${input.directory}\\${input.fileName}`,bytes:Math.floor(input.base64.length*3/4),sha256:'0'.repeat(64)}
    },
    async planFileAdd(input){
      // Browser demo: nothing is read or written; the listings gain the file once the job completes.
      const theme=input.kind==='theme'
      if(!(theme?/\.json$/i:/\.(wav|ogg)$/i).test(input.file))throw error('INVALID_PATH','installer.demo.invalidFile')
      const folder=theme?'Saved\\SaveGames\\Themes':'sounds'
      const taken=theme?['Clean Dark.json','snowi clarity.json','clover-alternate.json','Broken.json',...added.theme]:['Bell5.wav','spawn05.wav','saya_kick_deeper.wav','hit.wav','Twice.wav','None.wav',...added.sound]
      if(taken.some(name=>name.toLowerCase()===input.file.toLowerCase()))throw error('ENGINE_ERROR','import.check.taken',{folder:theme?'Themes':'sounds',file:input.file})
      const category=theme?'themes':'sounds'
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:[category],sourceId:null,rows:[{key:`${category}/${input.file}`,category,source:input.sourcePath,target:`${input.gameRoot}\\FPSAimTrainer\\${folder}\\${input.file}`,action:'create',conflict:false,unowned:false}],skipped:[]}
      imports.set(currentPlan.planId,{kind:input.kind,file:input.file})
      return clone(currentPlan)
    },
    async planCrosshairAdd(input){
      if(!input.file.endsWith('.png'))throw error('INVALID_PATH','installer.demo.invalidCrosshair')
      const target=`${input.gameRoot}\\FPSAimTrainer\\crosshairs\\${input.file}`
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:['crosshairs'],sourceId:null,rows:[{key:`crosshairs/${input.file}`,category:'crosshairs',source:null,target,action:'create',conflict:false,unowned:false}],skipped:[]}
      return clone(currentPlan)
    },
    async planCrosshair(input){
      if(!input.file.endsWith('.png'))throw error('INVALID_PATH','installer.demo.invalidCrosshair')
      const target=`${input.gameRoot}\\FPSAimTrainer\\crosshairs\\${input.file}`
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'install',location:location(input.gameRoot),packRoot:null,categories:['crosshairs'],sourceId:null,rows:[{key:`crosshairs/${input.file}`,category:'crosshairs',source:null,target,action:'replace',conflict:false,unowned:false}],skipped:[]}
      return clone(currentPlan)
    },
    async planRestore(input){
      if(input.sourceId!=='pristine'&&!records.some(b=>b.id===input.sourceId))throw error('BACKUP_INVALID','installer.demo.backupNotFound')
      if(!records.length)throw error('BACKUP_INVALID','installer.demo.nothingToRestore')
      const target=input.sourceId==='pristine'?original:snapshots.get(input.sourceId)
      const rows=Array.from(installed.values()).filter(r=>r.source!==null).map(r=>({...r,action:(target?.get(r.key)?.source===r.source?'skip':target?.has(r.key)?'restore':'delete') as FileRow['action'],conflict:false,unowned:false}))
      currentPlan={planId:crypto.randomUUID(),revision:input.revision,kind:'restore',location:location(input.gameRoot),packRoot:null,categories:[...new Set(rows.map(r=>r.category))],sourceId:input.sourceId,rows,skipped:[]}
      return clone(currentPlan)
    },
    async execute(input){
      const existing=jobs.get(input.operationId)
      if(existing){if(existing.plan.planId!==input.planId)throw error('BUSY','installer.demo.operationIdUsed');return complete(existing)}
      if(!currentPlan||currentPlan.planId!==input.planId)throw error('PLAN_MISSING','installer.error.planStale')
      if(currentPlan.kind!==input.confirmation)throw error('PLAN_STALE','installer.demo.confirmationMismatch')
      const job:Job={operationId:input.operationId,planId:input.planId,state:'running',progress:null,result:null,error:null}
      const entry={job,plan:clone(currentPlan),start:Date.now(),applied:false};jobs.set(input.operationId,entry)
      return complete(entry)
    },
    async job(id){const entry=jobs.get(id);if(!entry)throw error('WORKER_UNAVAILABLE','installer.demo.noJob');return complete(entry)},
    async reconcile(id){return {job:await bridge.job(id),backups:await bridge.backups(gameRoot)}},
    async pickFolder(kind){return kind==='game'?gameRoot:kind==='export'?'C:\\Users\\Player\\Pictures\\Crosshairs':packRoot},
    async pickFile(kind){return kind==='theme'?'/demo/downloads/Night-arena.json':kind==='crosshair'?'/demo/crosshair/Green-cross.png':'/demo/downloads/Soft-click.wav'},
    async openBackup(){/* Demo intentionally has no OS/file effect. */},
    // The browser demo never reaches the network and never touches a file: a report is built
    // from the text alone, the account is a fixed answer, and no update is ever known.
    async reportPreview(input){const text=`Aimloom demo report\n${input.description??''}`;return {text,sha256:'0'.repeat(64),bytes:new TextEncoder().encode(text).length}},
    async reportSend(){return {number:'AL-DEMO-0000'}},
    async accountResolve(){return {steamId:'76561190000000000',name:'Demo Player'}},
    async updateCheck(){return {latest:null,newer:false,channel:'stable' as const}},
    async openLogs(){/* Demo intentionally has no OS/file effect. */},
    async openDownload(){/* Demo intentionally has no OS/file effect. */},
    async appInfo(){return {label:__APP_VERSION__,channel:'stable' as const}},
  }
  return bridge
}
