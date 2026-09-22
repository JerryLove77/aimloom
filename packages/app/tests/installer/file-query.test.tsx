import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileTable } from '../../src/installer/components/FileTable';
import { queryFiles } from '../../src/installer/file-query';
import type { FileRow } from '../../src/installer/contracts';
const rows: FileRow[] = Array.from({ length: 65 }, (_, i) => ({ key: String(i), category: 'themes', source: null, target: `/game/themes/file-${String(i).padStart(2, '0')}.ini`, action: i % 2 ? 'create' : 'replace', conflict: false, unowned: false }));
describe('file review', () => {
    it('paginates 30 rows and clamps pages after filtering', () => { expect(queryFiles(rows, '', false, 1).rows).toHaveLength(30); const result = queryFiles(rows, 'file-64', false, 3); expect(result.page).toBe(1); expect(result.total).toBe(1); });
    it('only-overwrite filter excludes additions without changing source rows', () => { expect(queryFiles(rows, '', true, 1).total).toBe(33); expect(rows).toHaveLength(65); });
    it('search clears immediately and returns focus to search', async () => { const user = userEvent.setup(); render(<FileTable rows={rows}/>); const input = screen.getByRole('searchbox', { name: '搜索文件' }); await user.type(input, 'missing'); expect(screen.getByText('没有匹配的文件')).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: '清空搜索' })); expect(input).toHaveFocus(); expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument(); });
});
