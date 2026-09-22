import { invoke } from '@tauri-apps/api/core'
import { InstallerFailure, type InstallerBridge, type Issue } from './contracts'
import { isEnglishText, localIssue } from './issue'
import { t } from '../i18n'
function normalize(error:unknown):InstallerFailure {
  let candidate=error
  if(typeof error==='string'){try{candidate=JSON.parse(error)}catch{/* plain native failure */}}
  if(candidate&&typeof candidate==='object'&&'code'in candidate&&'message'in candidate){return new InstallerFailure(candidate as Issue)}
  // A plain native string is often Chinese; the English side then gets the fallback, never a copy.
  if(typeof error==='string')return new InstallerFailure({code:'WORKER_UNAVAILABLE',message:error,messageEn:isEnglishText(error)?error:t('en','installer.error.workerUnavailable'),path:null})
  return new InstallerFailure(localIssue('WORKER_UNAVAILABLE','installer.error.workerUnavailable'))
}
async function call<T>(command:string,args?:Record<string,unknown>):Promise<T>{try{return await invoke<T>(command,args)}catch(e){throw normalize(e)}}
export function createNativeBridge():InstallerBridge {
  const read=<T,>(op:string,args:Record<string,unknown>={})=>call<T>('installer_read',{op,args})
  return {
    discover:()=>read('discover'),locate:gameRoot=>read('locate',{gameRoot}),catalog:packRoot=>read('catalog',{packRoot}),
    backups:gameRoot=>read('backups',{gameRoot}),gameState:()=>read('gameState'),
    planInstall:input=>read('planInstall',input),planRestore:input=>read('planRestore',input),
    schemeList:gameRoot=>read('schemeList',{gameRoot}),planScheme:input=>read('planScheme',{...input}),
    audioList:gameRoot=>read('audioList',{gameRoot}),planAudio:input=>read('planAudio',{...input}),
    crosshairList:gameRoot=>read('crosshairList',{gameRoot}),planCrosshair:input=>read('planCrosshair',{...input}),
    planCrosshairAdd:input=>read('planCrosshairAdd',{...input}),
    planFileAdd:input=>read('planFileAdd',{...input}),
    exportFile:input=>read('exportFile',{...input}),
    enemyList:gameRoot=>read('enemyList',{gameRoot}),planEnemy:input=>read('planEnemy',{...input}),
    planProfileApply:input=>read('planProfileApply',{...input}),
    execute:input=>call('installer_execute',{input}),job:operationId=>call('installer_job',{operationId}),
    reconcile:operationId=>call('installer_reconcile',{operationId}),
    pickFolder:(kind,lang)=>call('installer_pick_folder',{kind,lang}),pickFile:(kind,lang)=>call('installer_pick_file',{kind,lang}),openBackup:gameRoot=>call('installer_open_backup',{gameRoot}),
    reportPreview:input=>call('installer_report_preview',{input}),reportSend:sha256=>call('installer_report_send',{sha256}),
    accountResolve:url=>call('installer_account_resolve',{url}),updateCheck:beta=>call('installer_update_check',{beta}),
    openLogs:()=>call('installer_open_logs'),openDownload:(lang,channel)=>call('installer_open_download',{lang,channel}),
    appInfo:()=>call('installer_app_info'),
  }
}
