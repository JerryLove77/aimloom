import { plural, useT } from '../../i18n';
import type { Preview } from '../contracts';
import { FileTable, actionNames } from '../components/FileTable';
import { categoryNames } from '../components/CategoryCard';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
export function ReviewPage({ preview, busy, blocked = false, onBack, onConfirm, onRefresh }: {
  preview: Preview;
  busy: boolean;
  blocked?: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const restore = preview.kind === 'restore';
  const actions = restore ? (['restore', 'delete', 'skip'] as const) : (['replace', 'create', 'skip'] as const);
  const primary = preview.categories.includes('primary');
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
        {actions.map(action => <div key={action} className={action === 'replace' ? 'is-emphasized' : ''}>
          <strong>
            {preview.rows.filter(r => r.action === action).length}
          </strong>
          <span>
            {t(actionNames[action])}
          </span>
        </div>)}
        <span className="ki-muted">{t('installer.files.aria')}</span>
      </div>
      <FileTable key={preview.planId} rows={preview.rows} restore={restore} />
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
        {t(restore ? 'installer.review.willRestore' : 'installer.review.willInstall')}
      </span>
      <h2>
        {preview.categories.map(c => t(categoryNames[c])).join(' / ') || t('installer.review.recordedFiles')}
      </h2>
      <div className="ki-summary-rule" />
      <div className="ki-setting-summary">
        <Icon name={primary ? 'warning' : 'shield'} />
        <div>
          <strong>
            {t(primary ? 'installer.review.primaryTitle' : restore ? 'installer.review.restoreTitle' : 'installer.review.keptTitle')}
          </strong>
          <p>
            {t(primary ? 'installer.review.primaryBody' : restore ? 'installer.review.restoreBody' : 'installer.review.keptBody')}
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
        {t(restore ? 'installer.review.protectFirst' : 'installer.review.backupFirst')}
      </p>
      {unowned ? <Notice tone="error">
        <p>{t('installer.review.unowned')}</p>
      </Notice> : null}
      <Button variant="primary" disabled={busy || blocked || unowned} onClick={onConfirm}>
        {t(busy ? 'installer.checking' : restore ? 'installer.review.confirmRestore' : 'installer.review.confirmInstall')}
        <Icon name={restore ? 'restore' : 'install'} size={18} />
      </Button>
      {blocked ? <Button onClick={onRefresh} disabled={busy}>{t('installer.refreshPlan')}</Button> : null}
      <span className="ki-summary-caption">
        {t(restore ? 'installer.review.restoreCaption' : 'installer.review.installCaption')}
      </span>
    </aside>
  </div><footer className="ki-footer">
      <Button onClick={onBack} disabled={busy}>{t(restore ? 'installer.review.backRestore' : 'installer.review.backInstall')}</Button>
      <span>{t('installer.review.footer')}</span>
    </footer></>;
}
