import type { ButtonHTMLAttributes, Ref } from 'react';
export function Button({ variant = 'secondary', className = '', type = 'button', onClick, ref, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  ref?: Ref<HTMLButtonElement>;
}) {
  return <button ref={ref} type={type} onClick={onClick} className={`ki-button ki-button-${variant} ${className}`} {...props} />;
}
