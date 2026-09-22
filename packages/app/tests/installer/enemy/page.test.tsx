import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EnemyPage } from '../../../src/enemy/EnemyPage'
import type { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import type { EnemyList, EnemyShape } from '../../../src/installer/contracts'

const skins: EnemyList['skins'] = [
  { label: 'None', model: 'None', skin: 'None', shapes: ['cylindrical', 'cuboid', 'spheroid'] },
  { label: 'Ghost', model: 'Ghost', skin: 'Default', shapes: ['cylindrical', 'cuboid', 'spheroid'] },
  { label: 'Stylized', model: 'Stylized Ecto', skin: 'Default', shapes: ['cylindrical'] },
]

function fixtures() {
  const plans: Array<{ shape: EnemyShape; model: string; skin: string }> = []
  const bridge = {
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async () => null,
    enemyList: async (): Promise<EnemyList> => ({
      current: { cylindrical: { model: 'Stylized Ecto', skin: 'Default' }, cuboid: { model: 'Ghost', skin: 'Default' }, spheroid: null },
      skins,
    }),
    planEnemy: async (input: { shape: EnemyShape; model: string; skin: string }) => { plans.push(input); return { planId: 'plan-1' } },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => ({ state: 'finished', result: { status: 'completed' } }),
    reconcile: async () => ({}),
  }
  return { bridge, plans }
}

const tree = (f: ReturnType<typeof fixtures>) => <EnemyPage bridge={f.bridge} section={'enemy' as WorkspaceSection} onSelect={() => {}} />

describe('Enemy page', () => {
  it('shows the humanoid tab first, with the current skin marked', async () => {
    render(tree(fixtures()))
    expect(await screen.findByRole('button', { name: /^人形/, pressed: true })).toBeVisible()
    const row = await screen.findByRole('button', { name: /^Stylized/ })
    expect(row.textContent).toContain('当前')
  })

  it('switching tabs filters the list to skins that support that shape', async () => {
    render(tree(fixtures()))
    await screen.findByRole('button', { name: /^Stylized/ })
    fireEvent.click(screen.getByRole('button', { name: /^方块/ }))
    expect(screen.queryByRole('button', { name: /^Stylized/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Ghost/ })).toBeVisible()
  })

  it('picking a different skin enables Apply; picking the current one does not', async () => {
    render(tree(fixtures()))
    const apply = await screen.findByRole('button', { name: '应用皮肤' })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^Stylized/ }))
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^None/ }))
    expect(apply).toBeEnabled()
  })

  it('applies the pending skin for the active shape and clears the pick', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: /^Ghost/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用皮肤' }))
    expect(await screen.findByRole('status', { name: '操作结果' })).toBeVisible()
    expect(f.plans).toHaveLength(1)
    expect(f.plans[0]).toMatchObject({ shape: 'cylindrical', model: 'Ghost', skin: 'Default' })
  })

  it('取消更改 discards the pick without planning anything', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: /^Ghost/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消更改' }))
    expect(screen.getByRole('button', { name: '应用皮肤' })).toBeDisabled()
    expect(f.plans).toEqual([])
  })

  it('keeps a pending pick when switching shape tabs, and re-shows it on return (decision B)', async () => {
    render(tree(fixtures()))
    fireEvent.click(await screen.findByRole('button', { name: /^None/ })) // pending for 人形 (cylindrical)
    expect(screen.getByRole('button', { name: '应用皮肤' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /^方块/ }))
    expect(screen.getByRole('button', { name: '应用皮肤' })).toBeDisabled() // nothing pending for 方块 yet
    fireEvent.click(screen.getByRole('button', { name: /^人形/ }))
    expect(screen.getByRole('button', { name: '应用皮肤' })).toBeEnabled()
    const row = screen.getByRole('button', { name: /^None/ })
    expect(row).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an unknown current pair as model · skin, raw and untranslated', async () => {
    const f = fixtures()
    f.bridge.enemyList = async () => ({
      current: { cylindrical: { model: 'Future Model', skin: 'Future Skin' }, cuboid: null, spheroid: null },
      skins,
    })
    render(tree(f))
    expect(await screen.findByText('Future Model · Future Skin')).toBeVisible()
  })

  it('shows a notice and nothing to pick when the shape has no settings block', async () => {
    const f = fixtures()
    f.bridge.enemyList = async () => ({ current: { cylindrical: null, cuboid: null, spheroid: null }, skins })
    render(tree(f))
    expect(await screen.findByText(/打开一次/)).toBeVisible()
    expect(screen.queryByRole('list', { name: '皮肤列表' })).toBeNull()
  })

  it('renders nothing while another section is active', () => {
    const f = fixtures()
    render(<EnemyPage bridge={f.bridge} isActive={false} section={'profile' as WorkspaceSection} onSelect={() => {}} />)
    expect(screen.queryByRole('button', { name: /^人形/ })).toBeNull()
  })
})
