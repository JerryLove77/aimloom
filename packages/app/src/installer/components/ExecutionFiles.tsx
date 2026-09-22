import { useT, type MessageKey } from '../../i18n'
import { useState } from 'react'
import type { Execution } from '../contracts'
import { Button } from './Button'
const labels:Record<string,MessageKey>={pending:'installer.execFiles.pending',writing:'installer.execFiles.writing',applied:'installer.execFiles.applied',restored:'installer.execFiles.restored',protected:'installer.execFiles.protected',skip:'installer.execFiles.skip',create:'installer.execFiles.applied',replace:'installer.execFiles.applied'}
export function ExecutionFiles({items}: {items:Execution['items']}) {
  const [page,setPage]=useState(1)
  const t=useT()
  const label=(state:string)=>{const key=labels[state];return key?t(key):state}
  const pageCount=Math.max(1,Math.ceil(items.length/30))
  const current=Math.min(page,pageCount)
  return <details className="ki-execution-files">
    <summary>{t('installer.execFiles.summary',{count:items.length})}</summary>
    <ul>{items.slice((current-1)*30,current*30).map((item,index)=><li key={`${item.key}-${index}`}>
      <code>{item.target}</code><span>{label(item.state)}</span>
    </li>)}</ul>
    <div className="ki-pagination">
      <Button disabled={current===1} onClick={()=>setPage(current-1)}>{t('installer.execFiles.prev')}</Button>
      <span>{t('installer.pagination.page',{page:current,pages:pageCount})}</span>
      <Button disabled={current===pageCount} onClick={()=>setPage(current+1)}>{t('installer.execFiles.next')}</Button>
    </div>
  </details>
}
