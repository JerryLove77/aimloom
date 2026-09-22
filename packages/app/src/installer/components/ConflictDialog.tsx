import { useT } from '../../i18n';
import type { FileRow } from '../contracts';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Notice } from './Notice';
export function ConflictDialog({ open, rows, onConfirm, onClose }: {
  open: boolean;
  rows: FileRow[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const blocked = rows.some(r => r.unowned);
  return <Dialog open={open} title={t(blocked ? 'installer.conflict.titleBlocked' : 'installer.conflict.title')} onClose={onClose}>
    <Notice tone="warning">
      {t(blocked ? 'installer.conflict.noticeBlocked' : 'installer.conflict.notice')}
    </Notice>
    <ul className="ki-conflict-files">
      {rows.filter(r => r.conflict || r.unowned).map(r => <li key={r.key}>
        <code>
          {r.target}
        </code>
        <span>
          {t(r.unowned ? 'installer.conflict.unowned' : 'installer.conflict.external')}
        </span>
      </li>)}
    </ul>
    <div className="ki-dialog-actions">
      <Button data-safe-focus onClick={onClose}>{t('installer.conflict.back')}</Button>
      {!blocked ? <Button variant="primary" onClick={onConfirm}>{t('installer.conflict.confirm')}</Button> : null}
    </div>
  </Dialog>;
}
