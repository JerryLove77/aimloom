import { plural, useT, type MessageKey } from '../../i18n';
import type { Category } from '../contracts';
import { Icon } from './Icon';
export const categoryNames: Record<Category, MessageKey> = { themes: 'installer.category.themes', sounds: 'installer.category.sounds', crosshairs: 'installer.category.crosshairs', ui: 'installer.category.ui', palette: 'installer.category.palette', primary: 'installer.category.primary' };
export const categoryDescriptions: Record<Category, MessageKey> = { themes: 'installer.category.desc.themes', sounds: 'installer.category.desc.sounds', crosshairs: 'installer.category.desc.crosshairs', ui: 'installer.category.desc.ui', palette: 'installer.category.desc.palette', primary: 'installer.category.desc.primary' };
export function CategoryCard({ category, count, checked, onChange, disabled = false, compact = false }: {
  category: Category;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  return <label className={`ki-category ${checked ? 'is-selected' : ''} ${compact ? 'is-compact' : ''} ${!count ? 'is-unavailable' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled || count === 0} onChange={e => onChange(e.target.checked)} aria-label={t(plural(count, 'installer.category.aria'), { name: t(categoryNames[category]), count })} />
    <span className="ki-category-icon">
      <Icon name={category} size={compact ? 20 : 26} />
    </span>
    <span className="ki-category-copy">
      <strong>
        {t(categoryNames[category])}
      </strong>
      <span>
        {t(categoryDescriptions[category])}
      </span>
      <small>
        {count ? t(plural(count, 'installer.fileCount'), { count }) : t('installer.category.none')}
      </small>
    </span>
    <span className="ki-checkbox" aria-hidden="true">
      {checked ? <Icon name="check" size={14} /> : null}
    </span>
  </label>;
}
