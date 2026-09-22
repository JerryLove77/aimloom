import { plural, useT, type MessageKey } from '../../i18n';
import { useMemo, useRef, useState } from 'react';
import type { FileRow } from '../contracts';
import { queryFiles } from '../file-query';
import { Button } from './Button';
import { Icon } from './Icon';
export const actionNames: Record<FileRow['action'], MessageKey> = { create: 'installer.action.create', replace: 'installer.action.replace', skip: 'installer.action.skip', restore: 'installer.action.restore', delete: 'installer.action.delete' };
export function FileTable({ rows, restore = false }: {
  rows: FileRow[];
  restore?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [changes, setChanges] = useState(false);
  const [page, setPage] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const result = useMemo(() => queryFiles(rows, query, changes, page), [rows, query, changes, page]);
  return <section className="ki-file-review" aria-label={t('installer.files.aria')}>
    <div className="ki-table-tools">
      <label className="ki-filter">
        <input type="checkbox" checked={changes} onChange={e => { setChanges(e.target.checked); setPage(1); }} />
        {t(restore ? 'installer.files.onlyRestores' : 'installer.files.onlyOverwrites')}
      </label>
      <div className="ki-search">
        <Icon name="search" size={16} />
        <input ref={input} type="search" aria-label={t('installer.files.searchAria')} placeholder={t('installer.files.searchPlaceholder')} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
        {query ? <button aria-label={t('installer.files.clearSearch')} type="button" onClick={() => { setQuery(''); setPage(1); input.current?.focus(); }}>
          <Icon name="close" size={16} />
        </button> : null}
      </div>
    </div>
    <div className="ki-table-scroll" tabIndex={0} aria-label={t('installer.files.scrollAria')}>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('installer.files.colAction')}</th>
            <th scope="col">{t('installer.files.colTarget')}</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map(row => <tr key={row.key}>
            <td>
              <span className={`ki-action ki-action-${row.action}`}>
                {t(actionNames[row.action])}
              </span>
            </td>
            <td>
              <strong className="ki-file-name">
                {row.target.split(/[\\/]/).at(-1)}
              </strong>
              <code>
                {row.target}
              </code>
              {row.conflict || row.unowned ? <span className="ki-file-risk">
                {t(row.unowned ? 'installer.files.riskUnowned' : 'installer.files.riskConflict')}
              </span> : null}
            </td>
          </tr>)}
        </tbody>
      </table>
      {result.total === 0 ? <div className="ki-empty">
        <Icon name="search" size={28} />
        <strong>
          {t(rows.length ? 'installer.files.noMatch' : 'installer.files.empty')}
        </strong>
        <p>
          {t(rows.length ? 'installer.files.noMatchBody' : 'installer.files.emptyBody')}
        </p>
      </div> : null}
    </div>
    <div className="ki-pagination">
      <span>{t(plural(result.total, 'installer.fileCount'), { count: result.total })}</span>
      <div>
        <Button variant="ghost" disabled={result.page === 1} onClick={() => setPage(result.page - 1)} aria-label={t('installer.files.prevAria')}>{t('installer.pagination.prev')}</Button>
        <span>{t('installer.pagination.page', { page: result.page, pages: result.pages })}</span>
        <Button variant="ghost" disabled={result.page === result.pages} onClick={() => setPage(result.page + 1)} aria-label={t('installer.files.nextAria')}>{t('installer.pagination.next')}</Button>
      </div>
    </div>
  </section>;
}
