import { useState } from 'react';
import { useMsg, useT, type Msg } from '../../i18n';
import { helpArticles } from '../help';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { errorMsg } from '../../workspace/issue-text';
import { FEEDBACK_EMAIL } from '../../workspace/SettingsPopover';
export function HelpPage({ onSendReport, onOpenLogs }: {
  /** Absent when this page is reached from a context that cannot send a report or open the log folder (a standalone render, e.g. tests) — the Feedback block then shows only what it can do. */
  onSendReport?: (() => void) | undefined;
  onOpenLogs?: (() => Promise<void>) | undefined;
} = {}) {
  const t = useT();
  const msg = useMsg();
  // 打开日志文件夹 can refuse (most often a fresh install where the worker has never spawned);
  // that refusal is a bilingual Issue and must be shown, not dropped as an unhandled rejection.
  const [logsError, setLogsError] = useState<Msg | null>(null);
  const openLogs = () => {
    setLogsError(null);
    onOpenLogs?.().catch((error: unknown) => { setLogsError(errorMsg(error, { key: 'settings.feedback.openLogsFailed' })); });
  };
  return <div className="ki-help-layout">
    <section className="ki-help-articles">
      {helpArticles.map(article => <details key={article.id} id={article.id} className="ki-help-article" open={article.id === 'location'}>
        <summary>
          {t(article.title)}
          <span aria-hidden="true">+</span>
        </summary>
        <p>
          {t(article.body)}
        </p>
      </details>)}
    </section>
    <aside className="ki-help-aside">
      <Icon name="shield" size={28} />
      <h2>{t('installer.helpAside.title')}</h2>
      <p>{t('installer.helpAside.offline')}</p>
      <p>{t('installer.helpAside.noAccount')}</p>
      <section className="ws-settings-section ki-help-feedback">
        <h3>{t('settings.feedback')}</h3>
        {/* The hint offers to send one from inside the app, so it only appears where that is possible. */}
        {onSendReport ? <p className="ws-muted">{t('settings.feedback.hint')}</p> : null}
        {onSendReport ? <Button variant="secondary" onClick={onSendReport}>{t('settings.feedback.send')}</Button> : null}
        {onOpenLogs ? <Button variant="ghost" onClick={openLogs}>{t('settings.feedback.openLogs')}</Button> : null}
        {logsError ? <Notice tone="error"><p>{msg(logsError)}</p></Notice> : null}
        <p className="ws-settings-email">{FEEDBACK_EMAIL}</p>
      </section>
      <span>Aimloom</span>
    </aside>
  </div>;
}
