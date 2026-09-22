import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog } from '../../src/installer/components/Dialog';
import { CategoryCard } from '../../src/installer/components/CategoryCard';
import { ConflictDialog } from '../../src/installer/components/ConflictDialog';
import type { FileRow } from '../../src/installer/contracts';
const row: FileRow = { key: '1', category: 'themes', source: null, target: '/game/config/edited.ini', action: 'restore', conflict: true, unowned: false };
describe('installer controls', () => {
    it('selects categories with native checkbox keyboard semantics', async () => {
        const onChange = vi.fn();
        render(<CategoryCard category="themes" count={12} checked={false} onChange={onChange}/>);
        const input = screen.getByRole('checkbox', { name: /主题/ });
        input.focus();
        await userEvent.setup().keyboard('[Space]');
        expect(onChange).toHaveBeenCalledWith(true);
    });
    it('does not offer missing categories', () => { render(<CategoryCard category="sounds" count={0} checked={false} onChange={vi.fn()}/>); expect(screen.getByRole('checkbox')).toBeDisabled(); });
    it('focuses safe action, traps focus, and restores focus after closing', async () => {
        const user = userEvent.setup();
        const close = vi.fn();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const { rerender } = render(<ConflictDialog open rows={[row]} onConfirm={vi.fn()} onClose={close}/>);
        expect(screen.getByRole('button', { name: '返回核对' })).toHaveFocus();
        await user.keyboard('{Shift>}{Tab}{/Shift}');
        expect(screen.getByRole('button', { name: '另存当前文件并继续恢复' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(close).toHaveBeenCalled();
        rerender(<ConflictDialog open={false} rows={[row]} onConfirm={vi.fn()} onClose={close}/>);
        expect(trigger).toHaveFocus();
        trigger.remove();
    });
    it('requires explicit conflict confirmation and blocks unowned files', async () => {
        const confirm = vi.fn();
        const user = userEvent.setup();
        const { rerender } = render(<ConflictDialog open rows={[row]} onConfirm={confirm} onClose={vi.fn()}/>);
        await user.click(screen.getByRole('button', { name: '返回核对' }));
        expect(confirm).not.toHaveBeenCalled();
        rerender(<ConflictDialog open rows={[{ ...row, unowned: true }]} onConfirm={confirm} onClose={vi.fn()}/>);
        expect(screen.queryByRole('button', { name: '另存当前文件并继续恢复' })).not.toBeInTheDocument();
        expect(screen.getByText('不属于此备份')).toBeInTheDocument();
    });
});

describe('Dialog sheet variant', () => {
    it('renders as a sheet, closes on Escape and returns focus to the trigger', async () => {
        const onClose = vi.fn();
        function Harness() {
            const [open, setOpen] = useState(false);
            return <><button onClick={() => setOpen(true)}>更改 背景</button>
                <Dialog variant="sheet" open={open} title="为 profile1 选择背景" onClose={() => { onClose(); setOpen(false); }}><button data-safe-focus>取消</button></Dialog></>;
        }
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: '更改 背景' });
        trigger.focus();
        fireEvent.click(trigger);
        const sheet = screen.getByRole('dialog', { name: '为 profile1 选择背景' });
        expect(sheet).toHaveClass('ki-sheet');
        fireEvent.keyDown(sheet, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('is an ordinary dialog without the variant', () => {
        render(<Dialog open title="删除 Profile" onClose={() => {}}><button data-safe-focus>取消</button></Dialog>);
        expect(screen.getByRole('dialog')).not.toHaveClass('ki-sheet');
    });
});
