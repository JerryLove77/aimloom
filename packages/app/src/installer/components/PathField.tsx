import { useT } from '../../i18n';
import { useId } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
export function PathField({ label, value, onChange, onChoose, hint, disabled = false, error }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onChoose: () => void;
  hint: string;
  disabled?: boolean;
  error?: string | undefined;
}) {
  const id = useId();
  const t = useT();
  return <div className="ki-path-field">
    <div className="ki-field-heading">
      <Icon name="folder" />
      <label htmlFor={id}>
        {label}
      </label>
    </div>
    <div className="ki-path-control">
      <input id={id} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" placeholder={t('installer.path.placeholder')} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint`} />
      <Button disabled={disabled} onClick={onChoose} aria-label={t('installer.path.chooseAria', { label })}>{t('installer.path.change')}</Button>
    </div>
    <p id={`${id}-hint`} className={error ? 'ki-field-error' : ''}>
      {error ?? hint}
    </p>
  </div>;
}
