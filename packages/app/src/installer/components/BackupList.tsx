import { plural, useLang, useT, type MessageKey } from '../../i18n';
import { useState } from 'react';
import type { Backup } from '../contracts';
import { categoryNames } from './CategoryCard';
import { Button } from './Button';
import { Icon } from './Icon';
const statusNames: Record<Backup['status'], MessageKey> = { prepared: 'installer.backup.status.prepared', applying: 'installer.backup.status.applying', completed: 'installer.backup.status.completed', 'rolled-back': 'installer.backup.status.rolledBack', 'recovery-required': 'installer.backup.status.recoveryRequired' };
export function BackupList({ records, selectedId, busy, onSelect }: {
  records: Backup[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const t = useT();
  const { lang } = useLang();
  const pending = (b: Backup) => ['prepared', 'applying', 'recovery-required'].includes(b.status);
  const sorted = [...records].sort((a, b) => Number(pending(b)) - Number(pending(a)) || b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(sorted.length / 30));
  const current = Math.min(page, pages);
  return <div className="ki-backup-list">
    <ul>
      {sorted.slice((current - 1) * 30, current * 30).map(backup => <li key={backup.id}>
        <button type="button" onClick={() => onSelect(backup.id)} disabled={busy} aria-pressed={selectedId === backup.id} className={`ki-backup-record ${pending(backup) ? 'is-pending' : ''}`}>
          <span className="ki-backup-record-top">
            <span>
              {t(backup.kind === 'install' ? 'installer.backup.kind.install' : 'installer.backup.kind.restore')}
            </span>
            <span className={`ki-badge ${pending(backup) ? 'ki-badge-warning' : ''}`}>
              {t(statusNames[backup.status])}
            </span>
          </span>
          <strong>
            {new Date(backup.createdAt).toString() === 'Invalid Date' ? backup.createdAt : new Date(backup.createdAt).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </strong>
          <span className="ki-backup-categories">
            {backup.categories.map(c => t(categoryNames[c])).join(' / ')}
          </span>
          <span className="ki-backup-record-bottom">
            <span>{t(plural(backup.fileCount, 'installer.fileCount'), { count: backup.fileCount })} · {backup.id.slice(0, 12)}</span>
            <Icon name="arrow" size={16} />
          </span>
        </button>
      </li>)}
    </ul>
    {pages > 1 ? <div className="ki-pagination">
      <Button disabled={current === 1} onClick={() => setPage(current - 1)}>{t('installer.pagination.prev')}</Button>
      <span>{current} / {pages}</span>
      <Button disabled={current === pages} onClick={() => setPage(current + 1)}>{t('installer.pagination.next')}</Button>
    </div> : null}
  </div>;
}
