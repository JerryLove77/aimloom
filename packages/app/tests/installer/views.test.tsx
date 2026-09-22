import { StrictMode } from 'react';
import { InstallerApp } from '../../src/installer/InstallerApp';
import { createDemoBridge } from '../../src/installer/demo-bridge';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectionPage } from '../../src/installer/pages/SelectionPage';
import { ExecutionPage } from '../../src/installer/pages/ExecutionPage';
import { ReviewPage } from '../../src/installer/pages/ReviewPage';
import type { Job, Preview } from '../../src/installer/contracts';
const preview: Preview = { planId: 'p', revision: 1, kind: 'install', location: { gameRoot: '/game', backupRoot: '/backup', gameState: 'closed' }, packRoot: '/pack', categories: ['themes'], sourceId: null, skipped: [], rows: [{ key: '1', category: 'themes', source: '/pack/file', target: '/game/file', action: 'replace', conflict: false, unowned: false }] };
const job: Job = { operationId: 'o', planId: 'p', state: 'running', progress: null, result: null, error: null };
const resultProps = { preview, busy: false, isDemo: true, onDone: vi.fn(), onBackups: vi.fn(), onOpenBackup: vi.fn(), onReconcile: vi.fn() };
describe('installer page states', () => {
    it('shows explicit Primary coverage on selection and review', () => { const { unmount } = render(<SelectionPage catalog={{ packRoot: '/pack', categories: [{ category: 'primary', count: 1 }], skipped: [] }} categories={['primary']} busy={false} onChange={vi.fn()} onBack={vi.fn()} onNext={vi.fn()}/>); expect(screen.getByText('完整设置将整体替换')).toBeInTheDocument(); unmount(); render(<ReviewPage preview={{ ...preview, categories: ['primary'] }} busy={false} onBack={vi.fn()} onConfirm={vi.fn()} onRefresh={vi.fn()}/>); expect(screen.getByText('完整设置：整体替换')).toBeInTheDocument(); });
    it('shows indeterminate progress when no real counts were reported', () => { render(<ExecutionPage {...resultProps} job={job}/>); expect(screen.getByRole('progressbar')).not.toHaveAttribute('value'); expect(screen.queryByText(/已处理/)).not.toBeInTheDocument(); });
    it('displays reported progress without inventing success', () => { render(<ExecutionPage {...resultProps} job={{ ...job, progress: { phase: 'verifying', completed: 2, total: 4, currentFile: '/game/file', batchId: 'b' } }}/>); expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2'); expect(screen.getByText('已处理 2 / 4')).toBeInTheDocument(); expect(screen.queryByText('文件安装完成')).not.toBeInTheDocument(); });
    it('unknown execution offers reconciliation and no retry-install action', async () => { const reconcile = vi.fn(); render(<ExecutionPage {...resultProps} job={{ ...job, state: 'unknown' }} onReconcile={reconcile}/>); expect(screen.getByText('执行结果尚未确认')).toBeInTheDocument(); await userEvent.setup().click(screen.getByRole('button', { name: '检查执行结果' })); expect(reconcile).toHaveBeenCalledOnce(); expect(screen.queryByRole('button', { name: '确认并安装' })).not.toBeInTheDocument(); });
    it('reports rollback and recovery-required outcomes distinctly', () => { const { rerender } = render(<ExecutionPage {...resultProps} job={{ ...job, state: 'finished', result: { status: 'rolled-back', batchId: 'b', items: [], errors: ['failed'], errorsEn: ['failed'] } }}/>); expect(screen.getByText('操作失败，已回滚')).toBeInTheDocument(); rerender(<ExecutionPage {...resultProps} job={{ ...job, state: 'finished', result: { status: 'recovery-required', batchId: 'b', items: [], errors: ['failed'], errorsEn: ['failed'] } }}/>); expect(screen.getByText('仍有文件需要恢复')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '进入恢复' })).toBeInTheDocument(); });
    it('prevents executing a plan with unowned files', () => { render(<ReviewPage preview={{ ...preview, rows: [{ ...preview.rows[0]!, unowned: true }] }} busy={false} onBack={vi.fn()} onConfirm={vi.fn()} onRefresh={vi.fn()}/>); expect(screen.getByRole('button', { name: '确认并安装' })).toBeDisabled(); });
});

it('keeps StrictMode live and opens help after a completed operation', async () => {
  const user = userEvent.setup();
  render(<StrictMode><InstallerApp bridge={createDemoBridge({ durationMs: 0 })} isDemo /></StrictMode>);
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步：选择内容' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: '下一步：选择内容' }));
  await user.click(await screen.findByRole('button', { name: '下一步：核对清单' }));
  await user.click(await screen.findByRole('button', { name: '确认并安装' }));
  await screen.findByText('文件安装完成');
  await user.click(screen.getByRole('button', { name: '使用帮助' }));
  expect(screen.getByText('如何找到游戏目录？')).toBeInTheDocument();
  expect(screen.queryByText('文件安装完成')).not.toBeInTheDocument();
});
it('describes rejected preflight separately from a post-write failure', () => {
  render(<ExecutionPage {...resultProps} job={{ ...job, state: 'failed', error: { code: 'PLAN_STALE', message: '清单已改变', messageEn: 'The plan changed', path: null } }} />);
  expect(screen.getByText('检查未通过，未写入文件')).toBeInTheDocument();
});

it('a rejected restore keeps its recovery destination and can rebuild its preview', async () => {
  const user=userEvent.setup()
  const bridge=createDemoBridge({durationMs:0})
  const found=await bridge.discover()
  const first=await bridge.planInstall({gameRoot:found.candidates[0]!,packRoot:found.defaultPack!,categories:['sounds'],revision:0})
  await bridge.execute({operationId:'seed',planId:first.planId,confirmation:'install',allowConflicts:false})
  const {InstallerFailure}=await import('../../src/installer/contracts')
  bridge.execute=async()=>{throw new InstallerFailure({code:'PLAN_STALE',message:'预览已改变',messageEn:'The preview changed',path:null})}
  render(<InstallerApp bridge={bridge} isDemo />)
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'游戏目录'})).toHaveValue(found.candidates[0]))
  await user.click(screen.getByRole('button',{name:'备份恢复'}))
  await user.click(await screen.findByRole('button',{name:/首次保护/}))
  await user.click(await screen.findByRole('button',{name:'确认恢复'}))
  await screen.findByText('检查未通过，未写入文件')
  expect(screen.getByRole('button',{name:'重新核对清单'})).toBeInTheDocument()
  await user.click(screen.getByRole('button',{name:'重新核对清单'}))
  await screen.findByRole('heading',{name:'核对这次恢复'})
  await user.click(screen.getByRole('button',{name:'确认恢复'}))
  await screen.findByText('检查未通过，未写入文件')
  await user.click(screen.getByRole('button',{name:'返回调整'}))
  expect(screen.getByRole('heading',{name:'从备份恢复配置'})).toBeInTheDocument()
})

it('keeps per-file execution states visible for a partially recovered batch', async()=>{
 const user=userEvent.setup()
 render(<ExecutionPage {...resultProps} job={{...job,state:'finished',result:{status:'recovery-required',batchId:'b',items:[{key:'sounds/a.wav',target:'/game/sounds/a.wav',state:'pending'}],errors:['write stopped'],errorsEn:['write stopped']}}} />)
 await user.click(screen.getByText(/查看逐文件处理结果/))
 expect(screen.getByText('/game/sounds/a.wav')).toBeInTheDocument()
 expect(screen.getByText('待处理')).toBeInTheDocument()
})
