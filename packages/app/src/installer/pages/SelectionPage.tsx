import { plural, useT } from '../../i18n';
import type { Catalog, Category } from '../contracts';
import { CategoryCard } from '../components/CategoryCard';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Notice } from '../components/Notice';
export function SelectionPage({ catalog, categories, busy, onChange, onBack, onNext }: {
  catalog: Catalog | null;
  categories: Category[];
  busy: boolean;
  onChange: (c: Category[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const count = (category: Category) => catalog?.categories.find(c => c.category === category)?.count ?? 0;
  const toggle = (category: Category, checked: boolean) => onChange(checked ? [...categories.filter(c => c !== category), category] : categories.filter(c => c !== category));
  return <><div className="ki-selection-intro">
    <span className="ki-panel-label">{t('installer.selection.assets')}</span>
    <span className="ki-muted">{t('installer.selection.assetsNote')}</span>
  </div><div className="ki-category-grid">
      {(['themes', 'sounds', 'crosshairs'] as Category[]).map(category => <CategoryCard key={category} category={category} count={count(category)} checked={categories.includes(category)} onChange={checked => toggle(category, checked)} disabled={busy} />)}
    </div><section className="ki-option-section">
      <div className="ki-section-title">
        <h2>{t('installer.selection.optional')}</h2>
        <span>{t('installer.selection.optionalNote')}</span>
      </div>
      <div className="ki-options">
        {(['ui', 'palette', 'primary'] as Category[]).map(category => <CategoryCard key={category} category={category} count={count(category)} checked={categories.includes(category)} onChange={checked => toggle(category, checked)} disabled={busy} compact />)}
      </div>
    </section>{categories.includes('primary') ? <Notice tone="warning" title={t('installer.selection.primaryTitle')}>
      <p>{t('installer.selection.primaryBody')}</p>
    </Notice> : <div className="ki-preserved">
      <Icon name="shield" size={18} />
      <span>{t('installer.selection.kept')}</span>
      <span>{t('installer.selection.keptNote')}</span>
    </div>}{catalog?.skipped.length ? <details className="ki-skipped">
      <summary>{t(plural(catalog.skipped.length, 'installer.selection.skipped'), { count: catalog.skipped.length })}</summary>
      <ul>
        {catalog.skipped.map((path, i) => <li key={`${path}-${i}`}>
          <code>
            {path}
          </code>
        </li>)}
      </ul>
    </details> : null}{!categories.length ? <p className="ki-field-error">{t('installer.selection.required')}</p> : null}<footer className="ki-footer">
      <Button onClick={onBack} disabled={busy}>{t('installer.selection.back')}</Button>
      <Button variant="primary" disabled={busy || !categories.length} onClick={onNext}>
        {t(busy ? 'installer.selection.building' : 'installer.selection.next')}
        <Icon name="arrow" size={17} />
      </Button>
    </footer></>;
}
