import type { ReactNode } from 'react';
import { Icon } from './Icon';
export function Notice({ children, tone = 'info', title }: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string | undefined;
}) {
  return <div className={`ki-notice ki-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'shield' : 'warning'} />
    <div>
      {title ? <strong>
        {title}
      </strong> : null}
      {children}
    </div>
  </div>;
}
