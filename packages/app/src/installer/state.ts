import type { BackupIndex, Catalog, Category, Discovery, Issue, Job, Location, Preview } from './contracts'
export type Route = 'install'|'restore'|'help'
export type Step = 1|2|3|4
export interface InstallerState {
  route: Route; step: Step; gameRoot: string; packRoot: string
  discovery: Discovery|null; location: Location|null; catalog: Catalog|null
  categories: Category[]; revision: number; preview: Preview|null
  backupIndex: BackupIndex|null; selectedBackupId: string|null
  job: Job|null; issue: Issue|null; busy: boolean; isDemo: boolean
}
export function createInitialState(): InstallerState {
  return {route:'install',step:1,gameRoot:'',packRoot:'',discovery:null,location:null,catalog:null,
    categories:['themes','sounds','crosshairs'],revision:0,preview:null,backupIndex:null,
    selectedBackupId:null,job:null,issue:null,busy:false,isDemo:false}
}
export type InstallerEvent =
  | {type:'game-changed';value:string}
  | {type:'pack-changed';value:string}
  | {type:'categories-changed';categories:Category[]}
  | {type:'patch';patch:Partial<InstallerState>}
export function installerReducer(state:InstallerState,event:InstallerEvent):InstallerState {
  if(event.type==='patch') return {...state,...event.patch}
  const base={...state,preview:null,issue:null,revision:state.revision+1,busy:false}
  if(event.type==='game-changed')return {...base,gameRoot:event.value,location:null,backupIndex:null,selectedBackupId:null}
  if(event.type==='pack-changed')return {...base,packRoot:event.value,catalog:null}
  return {...base,categories:[...new Set(event.categories)]}
}
export const operationBlocksNavigation=(job:Job|null)=>job?.state==='running'||job?.state==='unknown'
export const hasPendingBackup=(index:BackupIndex|null)=>Boolean(index?.records.some(b=>['prepared','applying','recovery-required'].includes(b.status)))
