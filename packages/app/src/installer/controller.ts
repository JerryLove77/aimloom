import { InstallerFailure, type Category, type InstallerBridge, type Issue, type Job, type Preview } from './contracts'
import { localIssue } from './issue'
import type { Lang } from '../i18n'
import { browserStorage } from '../i18n'
import { resolveGameRoot, writeGameRoot, type GameRootStorage } from '../workspace/game-root'
import { createInitialState, hasPendingBackup, installerReducer, operationBlocksNavigation, type InstallerState, type Route, type Step } from './state'
const issueOf=(error:unknown):Issue => error instanceof InstallerFailure ? error.issue : {code:'ENGINE_ERROR',message:error instanceof Error?error.message:String(error),messageEn:error instanceof Error?error.message:String(error),path:null}
const fail=(code:Issue['code'],key:Parameters<typeof localIssue>[1])=>new InstallerFailure(localIssue(code,key))
export function createInstallerController(bridge:InstallerBridge,initialState:InstallerState=createInitialState(),storage:GameRootStorage=browserStorage()) {
  let state=initialState
  const listeners=new Set<()=>void>()
  let readSequence=0, inFlight:Promise<Job|null>|null=null, discoveryPromise:Promise<void>|null=null
  let disposed=false
  const publish=(patch:Partial<InstallerState>)=>{state={...state,...patch}; if(!disposed)listeners.forEach(fn=>fn())}
  const changed=(event:Parameters<typeof installerReducer>[1])=>{if(operationBlocksNavigation(state.job))return;readSequence++;state=installerReducer(state,event);listeners.forEach(fn=>fn())}
  async function read(work:(revision:number)=>Promise<Partial<InstallerState>>) {
    const sequence=++readSequence,revision=state.revision
    publish({busy:true,issue:null})
    try {const patch=await work(revision); if(sequence===readSequence&&revision===state.revision)publish({...patch,busy:false})}
    catch(e){if(sequence===readSequence&&revision===state.revision)publish({issue:issueOf(e),busy:false})}
  }
  async function locate() {
    const root=state.gameRoot
    await read(async()=>{
      if(!root.trim())throw fail('INVALID_PATH','installer.error.selectGameFirst')
      const location=await bridge.locate(root)
      const backupIndex=await bridge.backups(location.gameRoot)
      writeGameRoot(storage,location.gameRoot)
      return {location,gameRoot:location.gameRoot,backupIndex,...(hasPendingBackup(backupIndex)?{route:'restore' as const,preview:null}:{})}
    })
  }
  async function loadCatalog() {
    const root=state.packRoot
    await read(async()=>{
      if(!root.trim())throw fail('INVALID_PACK','installer.error.selectPackFirst')
      const catalog=await bridge.catalog(root)
      const available=new Set(catalog.categories.filter(c=>c.count>0).map(c=>c.category))
      return {catalog,packRoot:catalog.packRoot,categories:state.categories.filter(c=>available.has(c))}
    })
  }
  function acceptPreview(preview:Preview):Partial<InstallerState>{return {preview,location:preview.location,selectedBackupId:preview.sourceId,step:3,route:preview.kind==='install'?'install':'restore'}}
  const controller={
    getState:()=>state,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener)}},
    dispose:()=>{disposed=true;listeners.clear();readSequence++},
    discover:()=>{
      if(discoveryPromise)return discoveryPromise
      discoveryPromise=read(async()=>{
        const discovery=await bridge.discover()
        const packRoot=state.packRoot||discovery.defaultPack||''
        if(!state.gameRoot){
          // The game is found by the one method Theme, Sounds, Crosshair, Enemy and Profile use
          // (`resolveGameRoot`: the remembered folder first, then discovery), so a "cannot find
          // the game" report means the same thing on every page. It is handed the discovery this
          // page already has, and its `location` is kept so the folder is not validated twice.
          const seen:{location:Awaited<ReturnType<InstallerBridge['locate']>>|null}={location:null}
          const found=await resolveGameRoot({discover:()=>Promise.resolve(discovery),locate:async root=>(seen.location=await bridge.locate(root))},storage).catch(()=>null)
          const location=seen.location
          if(found?.gameRoot&&location){
            const backupIndex=await bridge.backups(found.gameRoot)
            return {discovery,gameRoot:found.gameRoot,packRoot,location,backupIndex,...(hasPendingBackup(backupIndex)?{route:'restore' as const,preview:null}:{})}
          }
        }
        return {discovery,gameRoot:state.gameRoot,packRoot}
      }).finally(()=>{discoveryPromise=null})
      return discoveryPromise
    },locate,loadCatalog,
    setGameRoot:(value:string)=>changed({type:'game-changed',value}),
    setPackRoot:(value:string)=>changed({type:'pack-changed',value}),
    setCategories:(categories:Category[])=>changed({type:'categories-changed',categories}),
    chooseFolder:async(kind:'game'|'pack',lang:Lang)=>{
      if(operationBlocksNavigation(state.job))return
      try{const value=await bridge.pickFolder(kind,lang);if(value!==null){if(kind==='game'){controller.setGameRoot(value);await locate()}else{controller.setPackRoot(value);await loadCatalog()}}}
      catch(e){publish({issue:issueOf(e)})}
    },
    goTo:(route:Route,step?:Step)=>{
      if(operationBlocksNavigation(state.job))return
      if(route==='install'&&hasPendingBackup(state.backupIndex)){publish({route:'restore',issue:localIssue('RECOVERY_REQUIRED','installer.error.unfinishedFound')});return}
      const next=step??state.step
      if(route==='install'&&next===2&&(!state.location||!state.catalog))return
      if(route==='install'&&next===3&&state.preview?.kind!=='install')return
      publish({route,step:next,issue:null,...(route!==state.route||(route==='restore'&&next===1)?{preview:null}:{}),...(next<4&&state.job?.state!=='running'?{job:null}:{})})
    },
    previewInstall:async()=>{
      if(operationBlocksNavigation(state.job))return
      const {gameRoot,packRoot,categories}=state
      publish({preview:null})
      await read(async revision=>{
        if(!state.location||!state.catalog)throw fail('INVALID_PATH','installer.error.confirmLocations')
        if(hasPendingBackup(state.backupIndex))throw fail('RECOVERY_REQUIRED','installer.error.recoverFirst')
        if(!categories.length)throw fail('INVALID_PACK','installer.error.selectCategory')
        return acceptPreview(await bridge.planInstall({gameRoot,packRoot,categories,revision}))
      })
    },
    previewRestore:async(sourceId:string)=>{
      if(operationBlocksNavigation(state.job))return
      const gameRoot=state.gameRoot
      publish({preview:null})
      await read(async revision=>acceptPreview(await bridge.planRestore({gameRoot,sourceId,revision})))
    },
    execute:(allowConflicts:boolean):Promise<Job|null>=>{
      if(inFlight)return inFlight
      if(state.busy){publish({issue:localIssue('BUSY','installer.error.updatingPlan')});return Promise.resolve(null)}
      const preview=state.preview
      if(operationBlocksNavigation(state.job)){publish({issue:localIssue('BUSY','installer.error.waitCurrent')});return Promise.resolve(null)}
      if(!preview||preview.revision!==state.revision){publish({issue:localIssue('PLAN_STALE','installer.error.planStale')});return Promise.resolve(null)}
      if(preview.location.gameState!=='closed'){publish({issue:localIssue('GAME_RUNNING','installer.error.quitAndReview')});return Promise.resolve(null)}
      if(preview.rows.some(r=>r.unowned)){publish({issue:localIssue('UNOWNED_FILE','installer.error.unowned')});return Promise.resolve(null)}
      if(preview.kind==='restore'&&preview.rows.some(r=>r.conflict)&&!allowConflicts){publish({issue:localIssue('CONFLICT','installer.error.confirmConflicts')});return Promise.resolve(null)}
      const operationId=crypto.randomUUID()
      const executionRevision=state.revision
      const stillOwnsState=()=>state.job?.operationId===operationId&&state.revision===executionRevision&&state.gameRoot===preview.location.gameRoot
      publish({busy:true,step:4,issue:null,job:{operationId,planId:preview.planId,state:'running',progress:null,result:null,error:null}})
      inFlight=Promise.resolve().then(async()=>{
        try{
          let job=await bridge.execute({operationId,planId:preview.planId,confirmation:preview.kind,allowConflicts:preview.kind==='restore'&&allowConflicts})
          publish({job,busy:job.state==='running'})
          while(job.state==='running'&&!disposed){await new Promise(r=>setTimeout(r,250));if(disposed)break;job=await bridge.job(operationId);publish({job,busy:job.state==='running'})}
          if(job.state==='finished'){
            try{const backupIndex=await bridge.backups(preview.location.gameRoot);if(stillOwnsState())publish({backupIndex,selectedBackupId:job.result?.batchId??state.selectedBackupId})}catch(e){if(stillOwnsState())publish({issue:issueOf(e)})}
          }
          if(job.error&&stillOwnsState())publish({issue:job.error})
          return job
        }catch(e){
          const issue=issueOf(e)
          const rejected=['PLAN_MISSING','PLAN_STALE','INVALID_PACK','INVALID_PATH','BUSY','GAME_RUNNING','GAME_STATE_UNKNOWN','CONFLICT','UNOWNED_FILE','RECOVERY_REQUIRED','BACKUP_INVALID','UNSUPPORTED_PLATFORM'].includes(issue.code)
          const job:Job={operationId,planId:preview.planId,state:rejected?'failed':'unknown',progress:state.job?.progress??null,result:null,error:issue}
          publish({job,issue,busy:false,...(rejected?{preview:null}:{})});return job
        }finally{inFlight=null}
      })
      return inFlight
    },
    refreshBackups:async()=>{
      if(operationBlocksNavigation(state.job))return
      const gameRoot=state.gameRoot
      await read(async()=>{const backupIndex=await bridge.backups(gameRoot);return {backupIndex,location:backupIndex.location}})
    },
    reconcile:async()=>{
      if(state.job?.state!=='unknown')return
      publish({busy:true})
      try{const result=await bridge.reconcile(state.job.operationId);publish({job:result.job,backupIndex:result.backups,preview:null,issue:result.job.error,busy:false})}
      catch(e){publish({issue:issueOf(e),busy:false})}
    },
    openBackup:async()=>{try{await bridge.openBackup(state.gameRoot)}catch(e){publish({issue:issueOf(e)})}},
  }
  return controller
}
export type InstallerController=ReturnType<typeof createInstallerController>
