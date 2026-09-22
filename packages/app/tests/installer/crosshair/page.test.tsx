import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalPngIssue, encodePng } from '../../../../crosshair/src/png'
import { CrosshairPage } from '../../../src/crosshair/CrosshairPage'
import type { WorkspaceSection } from '../../../src/workspace/WorkspaceShell'
import type { ProfileAssetBridge } from '../../../src/profiles/assets'

vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:crosshair'), revokeObjectURL: vi.fn() }))

const canonical = encodePng({ width: 3, height: 2, data: new Uint8Array(3 * 2 * 4).fill(200), warnings: [] })

function fixtures(options: { picked?: string | null; job?: { state: string; result?: { status: string } } } = {}) {
  const plans: { file: string }[] = []
  const pngs: string[] = []
  const pickKinds: string[] = []
  const reconciled: string[] = []
  const picked = options.picked === undefined ? 'D:/Pictures/my-crosshair.png' : options.picked
  const bridge = {
    discover: async () => ({ candidates: ['D:/Game'] }),
    locate: async (root: string) => ({ gameRoot: root }),
    pickFolder: async (kind: string) => (kind === 'export' ? 'D:/Exports' : null),
    crosshairList: async (root: string) => ({
      directory: `${root}/crosshairs`,
      crosshairs: [
        { name: 'aimloom_slot', file: 'aimloom_slot.png', path: 'D:/Game/FPSAimTrainer/crosshairs/aimloom_slot.png' },
        { name: 'dot', file: 'dot.png', path: 'D:/Game/FPSAimTrainer/crosshairs/dot.png' },
      ],
    }),
    planCrosshair: async (input: { file: string }) => { plans.push({ file: input.file }); return { planId: 'plan-1' } },
    planCrosshairAdd: async (input: { file: string; pngBase64: string }) => { plans.push({ file: input.file }); pngs.push(input.pngBase64); return { planId: 'plan-1' } },
    execute: async () => ({ operationId: 'op-1' }),
    job: async () => options.job ?? ({ state: 'finished', result: { status: 'completed' } }),
    reconcile: async (operationId: string) => { reconciled.push(operationId); return {} },
    pickFile: async (kind: 'theme' | 'sound' | 'crosshair') => { pickKinds.push(kind); return picked },
    exported: [] as { directory: string; fileName: string }[],
    async exportFile(input: { directory: string; fileName: string; base64: string; gameRoot: string }) {
      this.exported.push({ directory: input.directory, fileName: input.fileName })
      return { path: `${input.directory}/${input.fileName}`, bytes: 100, sha256: 'a'.repeat(64) }
    },
  }
  const assets: ProfileAssetBridge = {
    chooseDirectory: async () => 'D:/Pictures',
    list: async () => ({ directory: 'D:/Pictures', files: [{ name: 'my-crosshair.png', path: 'D:/Pictures/my-crosshair.png' }], errors: [] }),
    read: async () => canonical,
  }
  return { bridge, assets, plans, pngs, pickKinds, reconciled }
}

const tree = (f: ReturnType<typeof fixtures>) => <CrosshairPage bridge={f.bridge} assets={f.assets} section={'crosshair' as WorkspaceSection} onSelect={() => {}} />

/** Clicks 拖入或选择 PNG; the fixture's native dialog returns my-crosshair.png. */
async function addFromPng() {
  fireEvent.click(await screen.findByRole('button', { name: '拖入或选择 PNG' }))
  const sheet = await screen.findByRole('dialog', { name: '添加准星图片' })
  await within(sheet).findByRole('img', { name: '新图案' })
  return sheet
}

/** Opens a file's sheet and picks the fixture PNG as its new image. */
async function replaceWithPng(file: string) {
  fireEvent.click(await screen.findByRole('button', { name: file }))
  const sheet = await screen.findByRole('dialog', { name: file })
  fireEvent.click(within(sheet).getByRole('button', { name: '换成别的图案…' }))
  await within(sheet).findByRole('img', { name: '新图案' })
  return sheet
}

describe('Crosshair page', () => {
  beforeEach(() => { vi.mocked(URL.createObjectURL).mockClear() })

  it('leads with the two ways to add a crosshair, and says the game chooses which one is used', async () => {
    render(tree(fixtures()))
    expect(await screen.findByRole('heading', { level: 1, name: '准星' })).toBeVisible()
    expect(screen.getByText(/用哪个准星要在游戏设置里选/)).toBeVisible()
    expect(screen.getByRole('button', { name: '粘贴准星代码' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '拖入或选择 PNG' })).toBeEnabled()
    // Nothing on the page itself is pending or applied: every write happens in a sheet.
    expect(screen.queryByRole('group', { name: '配置状态' })).toBeNull()
    expect(screen.queryByRole('button', { name: '应用准星' })).toBeNull()
  })

  it('opens the code sheet and the PNG sheet from the two cards', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: '粘贴准星代码' }))
    expect(await screen.findByRole('dialog', { name: '粘贴准星代码' })).toHaveClass('ki-sheet')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const sheet = await addFromPng()
    expect(sheet).toHaveClass('ki-sheet')
    expect(f.pickKinds).toEqual(['crosshair'])
    expect(within(sheet).getByLabelText('文件名')).toHaveValue('my-crosshair')
    expect(within(sheet).getByText('D:/Pictures/my-crosshair.png')).toBeVisible()
    expect(within(sheet).getByText('D:/Game/crosshairs')).toBeVisible()
  })

  it('a cancelled file dialog opens nothing and writes nothing', async () => {
    const f = fixtures({ picked: null })
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: '拖入或选择 PNG' }))
    await waitFor(() => expect(f.pickKinds).toEqual(['crosshair']))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(f.plans).toEqual([])
  })

  it('adds a picked PNG to the game under its own name', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await addFromPng()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '添加到游戏' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.plans).toEqual([{ file: 'my-crosshair.png' }])
    expect(await screen.findByRole('status', { name: '操作结果' })).toHaveTextContent(/已新增准星「my-crosshair\.png」/)
  })

  it('refuses a name an installed crosshair already uses, before anything is sent', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await addFromPng()
    fireEvent.change(within(sheet).getByLabelText('文件名'), { target: { value: 'dot' } })
    expect(within(sheet).getByText(/已经有一个准星/)).toBeVisible()
    expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeDisabled()
    expect(f.plans).toEqual([])
  })

  it('can pick another PNG from inside the sheet', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await addFromPng()
    fireEvent.click(within(sheet).getByRole('button', { name: '换一张…' }))
    await waitFor(() => expect(f.pickKinds).toEqual(['crosshair', 'crosshair']))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('lists the crosshairs already in the game and filters them as the player types', async () => {
    render(tree(fixtures()))
    expect(await screen.findByRole('heading', { name: '游戏里已有的准星 · 2 个' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'aimloom_slot.png' })).toBeVisible()
    const search = screen.getByRole('searchbox', { name: '搜索准星' })
    fireEvent.change(search, { target: { value: 'DOT' } })
    expect(screen.getByRole('button', { name: 'dot.png' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'aimloom_slot.png' })).toBeNull()
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(/没有匹配「zzz」的准星/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(screen.getByRole('button', { name: 'aimloom_slot.png' })).toBeVisible()
  })

  it('opening a crosshair explains replacing, and 替换 waits for a new image', async () => {
    const f = fixtures()
    render(tree(f))
    fireEvent.click(await screen.findByRole('button', { name: 'dot.png' }))
    const sheet = await screen.findByRole('dialog', { name: 'dot.png' })
    expect(within(sheet).getByText(/如果游戏里正在用这个文件，换图案后下次启动 KovaaK 就是新准星/)).toBeVisible()
    expect(within(sheet).getByText('D:/Game/FPSAimTrainer/crosshairs/dot.png')).toBeVisible()
    expect(within(sheet).getByRole('button', { name: '替换' })).toBeDisabled()
    fireEvent.click(within(sheet).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.plans).toEqual([])
  })

  it('replaces a crosshair image after showing old and new side by side', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await replaceWithPng('dot.png')
    expect(within(sheet).getByRole('img', { name: '原图案' })).toBeVisible()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '替换' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '替换' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.plans).toEqual([{ file: 'dot.png' }])
    expect(await screen.findByRole('status', { name: '操作结果' })).toHaveTextContent(/已替换「dot\.png」的图案/)
  })

  it('an unknown result closes the sheet and locks the page until 核对结果', async () => {
    const f = fixtures({ job: { state: 'unknown' } })
    render(tree(f))
    const sheet = await replaceWithPng('dot.png')
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '替换' })).toBeEnabled())
    fireEvent.click(within(sheet).getByRole('button', { name: '替换' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: '粘贴准星代码' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '拖入或选择 PNG' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '核对结果' }))
    await waitFor(() => expect(f.reconciled).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '粘贴准星代码' })).toBeEnabled())
  })

  /** Opens the code sheet, renders the fixture code and types a name. */
  async function openCodeSheet(name: string) {
    fireEvent.click(await screen.findByRole('button', { name: '粘贴准星代码' }))
    const sheet = await screen.findByRole('dialog', { name: '粘贴准星代码' })
    fireEvent.change(within(sheet).getByLabelText('准星代码'), { target: { value: 'CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '预览' }))
    expect(await within(sheet).findByRole('img', { name: '准星代码预览' })).toBeVisible()
    fireEvent.change(within(sheet).getByLabelText('文件名'), { target: { value: name } })
    return sheet
  }

  it('turns a pasted code into a crosshair added straight to the game', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await openCodeSheet('from-code')
    // The destination is the game's own folder; the player never picks one.
    expect(within(sheet).getByText('D:/Game/crosshairs')).toBeVisible()
    fireEvent.click(within(sheet).getByRole('button', { name: '添加到游戏' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(f.plans).toEqual([{ file: 'from-code.png' }])
    expect(f.bridge.exported).toEqual([])
    expect(canonicalPngIssue(Uint8Array.from(Buffer.from(f.pngs[0]!, 'base64')))).toBeNull()
    expect(await screen.findByRole('status', { name: '操作结果' })).toHaveTextContent(/已新增准星「from-code\.png」.*到游戏.*选中它/)
  })

  it('can still save the PNG to another folder without planning a game write', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await openCodeSheet('from-code')
    fireEvent.click(within(sheet).getByRole('button', { name: '另存到其他文件夹…' }))
    expect(await within(sheet).findByText(/已保存 PNG 到 D:\/Exports\/from-code\.png/)).toBeVisible()
    expect(f.bridge.exported).toEqual([{ directory: 'D:/Exports', fileName: 'from-code.png' }])
    // Saving a copy is not a game change: nothing was planned.
    expect(f.plans).toEqual([])
  })

  it('only one sheet is open while adding from a code', async () => {
    render(tree(fixtures()))
    await openCodeSheet('from-code')
    // The code sheet borrows add mode for its name rules; the PNG sheet must not open beside it.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: '添加准星图片' })).toBeNull()
  })

  it('refuses a code name an installed crosshair already uses', async () => {
    const f = fixtures()
    render(tree(f))
    const sheet = await openCodeSheet('dot')
    expect(within(sheet).getByText(/已经有一个准星/)).toBeVisible()
    expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: '另存到其他文件夹…' })).toBeEnabled()
    expect(f.plans).toEqual([])
  })

  it('shows why a pasted code cannot be previewed', async () => {
    render(tree(fixtures()))
    fireEvent.click(await screen.findByRole('button', { name: '粘贴准星代码' }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('准星代码'), { target: { value: 'not a code' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '预览' }))
    // The field label also says 准星代码, so match the parser's own refusal.
    expect(await within(sheet).findByText(/未识别准星代码/)).toBeVisible()
    expect(within(sheet).getByRole('button', { name: '添加到游戏' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: '另存到其他文件夹…' })).toBeDisabled()
  })

  describe('fine-tune (CUR-C2)', () => {
    it('shows CS2 controls and both a dark and a light swatch, and adding uses the tuned PNG', async () => {
      const f = fixtures()
      render(tree(f))
      const sheet = await openCodeSheet('from-code')
      expect(within(sheet).getByRole('heading', { name: '微调' })).toBeVisible()
      expect(within(sheet).getByText('长度')).toBeVisible()
      expect(within(sheet).getByText('颜色')).toBeVisible()
      // Both swatches are present: the dark one keeps the page's usual preview name.
      expect(within(sheet).getByRole('img', { name: '准星代码预览' })).toBeVisible()
      expect(within(sheet).getByRole('img', { name: /准星代码预览 · 浅色底/ })).toBeVisible()

      const slider = within(sheet).getByLabelText('长度') as HTMLInputElement
      fireEvent.change(slider, { target: { value: '9' } })
      fireEvent.click(within(sheet).getByRole('button', { name: '添加到游戏' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(f.plans).toEqual([{ file: 'from-code.png' }])
      expect(canonicalPngIssue(Uint8Array.from(Buffer.from(f.pngs[0]!, 'base64')))).toBeNull()
    })

    it('shows VALORANT controls for a VALORANT code', async () => {
      render(tree(fixtures()))
      fireEvent.click(await screen.findByRole('button', { name: '粘贴准星代码' }))
      const sheet = await screen.findByRole('dialog', { name: '粘贴准星代码' })
      fireEvent.change(within(sheet).getByLabelText('准星代码'), { target: { value: '0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0' } })
      fireEvent.click(within(sheet).getByRole('button', { name: '预览' }))
      await within(sheet).findByRole('img', { name: '准星代码预览' })
      expect(within(sheet).getByText('内线长度')).toBeVisible()
      expect(within(sheet).getByText('外线间隙')).toBeVisible()
      expect(within(sheet).queryByText('长度')).toBeNull()
    })

    it('reset restores the pasted code, and the code textarea itself never changes', async () => {
      const f = fixtures()
      render(tree(f))
      const sheet = await openCodeSheet('from-code')
      const before = (within(sheet).getByRole('img', { name: '准星代码预览' }) as HTMLImageElement).src
      const codeBefore = (within(sheet).getByLabelText('准星代码') as HTMLTextAreaElement).value
      fireEvent.change(within(sheet).getByLabelText('长度'), { target: { value: '9' } })
      expect((within(sheet).getByRole('img', { name: '准星代码预览' }) as HTMLImageElement).src).not.toBe(before)
      expect(within(sheet).getByRole('button', { name: '恢复成粘贴的代码' })).toBeEnabled()
      fireEvent.click(within(sheet).getByRole('button', { name: '恢复成粘贴的代码' }))
      expect((within(sheet).getByRole('img', { name: '准星代码预览' }) as HTMLImageElement).src).toBe(before)
      expect((within(sheet).getByLabelText('准星代码') as HTMLTextAreaElement).value).toBe(codeBefore)
      expect(within(sheet).getByRole('button', { name: '恢复成粘贴的代码' })).toBeDisabled()
    })

    it('a tuned save-elsewhere copy carries the tuned bytes too', async () => {
      const f = fixtures()
      render(tree(f))
      const sheet = await openCodeSheet('from-code')
      fireEvent.change(within(sheet).getByLabelText('粗细'), { target: { value: '5' } })
      fireEvent.click(within(sheet).getByRole('button', { name: '另存到其他文件夹…' }))
      await within(sheet).findByText(/已保存 PNG 到/)
      expect(f.bridge.exported).toEqual([{ directory: 'D:/Exports', fileName: 'from-code.png' }])
    })

    it('the dark and light swatches carry different backgrounds (regression: the light swatch must not stay dark)', async () => {
      render(tree(fixtures()))
      const sheet = await openCodeSheet('from-code')
      const dark = within(sheet).getByRole('img', { name: '准星代码预览' }) as HTMLImageElement
      const light = within(sheet).getByRole('img', { name: /准星代码预览 · 浅色底/ }) as HTMLImageElement
      expect(dark.style.background).not.toBe('')
      expect(light.style.background).not.toBe('')
      expect(dark.style.background).not.toBe(light.style.background)
    })

    it('draws CS2 colour presets as named swatch buttons, not a numeric slider', async () => {
      render(tree(fixtures()))
      const sheet = await openCodeSheet('from-code')
      const group = within(sheet).getByRole('radiogroup', { name: '颜色' })
      const red = within(group).getByRole('radio', { name: '红' })
      expect(red).toBeVisible()
      expect(within(group).getByRole('radio', { name: '自定义' })).toBeVisible()
      // The old numeric palette slider is gone.
      expect(within(sheet).queryByLabelText('颜色', { selector: 'input[type="range"]' })).toBeNull()
    })

    it('the fixture code already selects custom (color 5): its picker shows by default; a preset hides it, custom brings it back', async () => {
      render(tree(fixtures()))
      const sheet = await openCodeSheet('from-code')
      const group = within(sheet).getByRole('radiogroup', { name: '颜色' })
      expect(within(group).getByRole('radio', { name: '自定义' })).toHaveAttribute('aria-checked', 'true')
      const picker = within(sheet).getByLabelText('自定义颜色') as HTMLInputElement
      expect(picker.type).toBe('color')
      fireEvent.change(picker, { target: { value: '#112233' } })
      // Choosing a preset hides the picker again.
      fireEvent.click(within(group).getByRole('radio', { name: '绿' }))
      expect(within(sheet).queryByLabelText('自定义颜色')).toBeNull()
      expect(within(group).getByRole('radio', { name: '绿' })).toHaveAttribute('aria-checked', 'true')
      // Choosing custom brings it back.
      fireEvent.click(within(group).getByRole('radio', { name: '自定义' }))
      expect(within(sheet).getByLabelText('自定义颜色')).toBeVisible()
    })

    it('VALORANT custom colour reveals an RGB picker plus a 0–1 alpha slider, and no hand-typed hex box', async () => {
      render(tree(fixtures()))
      fireEvent.click(await screen.findByRole('button', { name: '粘贴准星代码' }))
      const sheet = await screen.findByRole('dialog', { name: '粘贴准星代码' })
      fireEvent.change(within(sheet).getByLabelText('准星代码'), { target: { value: '0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0' } })
      fireEvent.click(within(sheet).getByRole('button', { name: '预览' }))
      await within(sheet).findByRole('img', { name: '准星代码预览' })
      const group = within(sheet).getByRole('radiogroup', { name: '颜色' })
      expect(within(group).getAllByRole('radio')).toHaveLength(9) // 8 presets + custom
      fireEvent.click(within(group).getByRole('radio', { name: '自定义' }))
      expect((within(sheet).getByLabelText('自定义颜色') as HTMLInputElement).type).toBe('color')
      const alpha = within(sheet).getByLabelText('自定义颜色透明度') as HTMLInputElement
      expect(alpha.type).toBe('range')
      expect(alpha.min).toBe('0'); expect(alpha.max).toBe('1')
      // No hand-typed hex box remains anywhere in the sheet.
      expect(within(sheet).queryByPlaceholderText('FFFFFFFF')).toBeNull()
    })

    it('disables a CS2 dependent control while its parent toggle is off, without discarding its value', async () => {
      render(tree(fixtures()))
      const sheet = await openCodeSheet('from-code')
      const outlineEnabled = within(sheet).getByLabelText('描边') as HTMLInputElement
      const outlineWidth = within(sheet).getByLabelText('描边宽度') as HTMLInputElement
      const alphaEnabled = within(sheet).getByLabelText('透明度') as HTMLInputElement
      const alphaValue = within(sheet).getByLabelText('透明度数值') as HTMLInputElement
      // The fixture code has both outline and alpha on.
      expect(outlineEnabled.checked).toBe(true)
      expect(alphaEnabled.checked).toBe(true)
      expect(outlineWidth).toBeEnabled()
      expect(alphaValue).toBeEnabled()
      const widthBefore = outlineWidth.value
      fireEvent.click(outlineEnabled)
      fireEvent.click(alphaEnabled)
      expect(outlineWidth).toBeDisabled()
      expect(alphaValue).toBeDisabled()
      // The value is kept, not reset, while disabled.
      expect(outlineWidth.value).toBe(widthBefore)
      // Turning it back on re-enables it with the same value.
      fireEvent.click(outlineEnabled)
      expect(outlineWidth).toBeEnabled()
      expect(outlineWidth.value).toBe(widthBefore)
    })

    it('disables VALORANT inner/outer line controls while that line is off', async () => {
      render(tree(fixtures()))
      fireEvent.click(await screen.findByRole('button', { name: '粘贴准星代码' }))
      const sheet = await screen.findByRole('dialog', { name: '粘贴准星代码' })
      fireEvent.change(within(sheet).getByLabelText('准星代码'), { target: { value: '0;P;h;0;d;1;z;2;a;1;f;0;0b;0;1b;0' } })
      fireEvent.click(within(sheet).getByRole('button', { name: '预览' }))
      await within(sheet).findByRole('img', { name: '准星代码预览' })
      const outerEnabled = within(sheet).getByLabelText('外线') as HTMLInputElement
      expect(outerEnabled.checked).toBe(false) // fixture code: 1b;0
      expect(within(sheet).getByLabelText('外线长度')).toBeDisabled()
      expect(within(sheet).getByLabelText('外线间隙')).toBeDisabled()
      fireEvent.click(outerEnabled)
      expect(within(sheet).getByLabelText('外线长度')).toBeEnabled()
    })

    it('says the running-game observation in the reworded terms', async () => {
      render(tree(fixtures()))
      const sheet = await openCodeSheet('from-code')
      expect(within(sheet).getByText('游戏开着也能添加：测试中，新准星不用重启游戏就能在准星设置里选到。')).toBeVisible()
    })
  })

  it('closing the code sheet leaves add mode, so nothing reopens', async () => {
    render(tree(fixtures()))
    const sheet = await openCodeSheet('from-code')
    fireEvent.click(within(sheet).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('leaving the section closes its sheets', async () => {
    const f = fixtures()
    const page = (isActive: boolean) => <CrosshairPage bridge={f.bridge} assets={f.assets} isActive={isActive} section={'crosshair' as WorkspaceSection} onSelect={() => {}} />
    const view = render(page(true))
    await addFromPng()
    view.rerender(page(false))
    view.rerender(page(true))
    expect(await screen.findByRole('heading', { level: 1, name: '准星' })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'dot.png' }))
    expect(await screen.findByRole('dialog', { name: 'dot.png' })).toBeVisible()
    view.rerender(page(false))
    view.rerender(page(true))
    expect(await screen.findByRole('heading', { level: 1, name: '准星' })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing while another section is active', () => {
    const f = fixtures()
    render(<CrosshairPage bridge={f.bridge} assets={f.assets} isActive={false} section={'profile' as WorkspaceSection} onSelect={() => {}} />)
    expect(screen.queryByRole('heading', { name: '准星' })).toBeNull()
  })
})
