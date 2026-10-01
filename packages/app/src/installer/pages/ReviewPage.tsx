import { plural, useT } from '../../i18n';
import type { Preview } from '../../bridge/contracts';
import { categoryNames } from '../category-names';
import { FileTable, actionNames } from '../components/FileTable';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
/** A restore preview: what each recorded file goes back to. */
export function ReviewPage({ preview, busy, blocked = false, onBack, onConfirm, onRefresh }: {
  preview: Preview;
  busy: boolean;
  blocked?: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const actions = ['restore', 'delete', 'skip'] as const;
  const unowned = preview.rows.some(r => r.unowned);
  return <><div className="ki-review-layout">
    <div className="ki-review-main">
      <details className="ki-path-summary">
        <summary>{t('installer.review.fullPaths')}</summary>
        <dl>
          <dt>{t('installer.gameFolder')}</dt>
          <dd>
            <code>
              {preview.location.gameRoot}
            </code>
          </dd>
          {preview.packRoot ? <><dt>{t('installer.review.pack')}</dt><dd>
            <code>
              {preview.packRoot}
            </code>
          </dd></> : null}
        </dl>
      </details>
      <div className="ki-file-counts">
        {actions.map(action => <div key={action}>
          <strong>
            {preview.rows.filter(r => r.action === action).length}
          </strong>
          <span>
            {t(actionNames[action])}
          </span>
        </div>)}
        <span className="ki-muted">{t('installer.files.aria')}</span>
      </div>
      <FileTable key={preview.planId} rows={preview.rows} restore />
      {preview.skipped.length ? <details className="ki-skipped">
        <summary>{t(plural(preview.skipped.length, 'installer.review.skipped'), { count: preview.skipped.length })}</summary>
        <ul>
          {preview.skipped.map((item, i) => <li key={i}>
            <code>
              {item}
            </code>
          </li>)}
        </ul>
      </details> : null}
    </div>
    <aside className="ki-review-summary">
      <span className="ki-panel-label">
        {t('installer.review.willRestore')}
      </span>
      <h2>
        {preview.categories.map(c => t(categoryNames[c])).join(' / ') || t('installer.review.recordedFiles')}
      </h2>
      <div className="ki-summary-rule" />
      <div className="ki-setting-summary">
        <Icon name="shield" />
        <div>
          <strong>
            {t('installer.review.restoreTitle')}
          </strong>
          <p>
            {t('installer.review.restoreBody')}
          </p>
        </div>
      </div>
      <div className="ki-backup-location">
        <span>{t('installer.backupLocation')}</span>
        <code>
          {preview.location.backupRoot}
        </code>
      </div>
      <p className="ki-summary-footnote">
        <Icon name="shield" size={17} />
        {t('installer.review.protectFirst')}
      </p>
      {unowned ? <Notice tone="error">
        <p>{t('installer.review.unowned')}</p>
      </Notice> : null}
      <Button variant="primary" disabled={busy || blocked || unowned} onClick={onConfirm}>
        {t(busy ? 'installer.checking' : 'installer.review.confirmRestore')}
        <Icon name="restore" size={18} />
      </Button>
      {blocked ? <Button onClick={onRefresh} disabled={busy}>{t('installer.refreshPlan')}</Button> : null}
      <span className="ki-summary-caption">
        {t('installer.review.restoreCaption')}
      </span>
    </aside>
  </div><footer className="ki-footer">
      <Button onClick={onBack} disabled={busy}>{t('installer.review.backRestore')}</Button>
      <span>{t('installer.review.footer')}</span>
    </footer></>;
}
