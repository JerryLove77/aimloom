import type { BackupIndex, Discovery, Issue, Job, Location, Preview } from '../bridge/contracts'
/** The backup and restore page and its help. Quick import lives on Explore (`explore/`). */
export type Route = 'restore'|'help'
/** 1: the backup list; 3: a restore preview; 4: the restore running or done. */
export type Step = 1|3|4
export interface InstallerState {
  route: Route; step: Step; gameRoot: string
  discovery: Discovery|null; location: Location|null
  revision: number; preview: Preview|null
  backupIndex: BackupIndex|null; selectedBackupId: string|null
  job: Job|null; issue: Issue|null; busy: boolean; isDemo: boolean
}
export function createInitialState(): InstallerState {
  return {route:'restore',step:1,gameRoot:'',discovery:null,location:null,revision:0,preview:null,backupIndex:null,
    selectedBackupId:null,job:null,issue:null,busy:false,isDemo:false}
}
export type InstallerEvent =
  | {type:'game-changed';value:string}
  | {type:'patch';patch:Partial<InstallerState>}
export function installerReducer(state:InstallerState,event:InstallerEvent):InstallerState {
  if(event.type==='patch') return {...state,...event.patch}
  return {...state,preview:null,issue:null,revision:state.revision+1,busy:false,gameRoot:event.value,location:null,backupIndex:null,selectedBackupId:null}
}
export const operationBlocksNavigation=(job:Job|null)=>job?.state==='running'||job?.state==='unknown'
export const hasPendingBackup=(index:BackupIndex|null)=>Boolean(index?.records.some(b=>['prepared','applying','recovery-required'].includes(b.status)))
