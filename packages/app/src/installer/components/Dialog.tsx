import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';

/**
 * A tiny external store, not a context: every sheet in the app already renders through this one
 * component, so counting mounts with `open` true here is the smallest way for `WorkspaceShell`
 * to know "some page's own sheet is open" without every page threading that fact upward by hand.
 * The Settings button reads it to become unreachable, and `Workspace.openReport` reads it to
 * refuse opening the report sheet over another one.
 */
let openDialogCount = 0;
const dialogListeners = new Set<() => void>();
function notifyDialogListeners() { dialogListeners.forEach(listener => listener()); }
export function isAnyDialogOpen(): boolean { return openDialogCount > 0; }
function subscribeDialogOpen(listener: () => void): () => void { dialogListeners.add(listener); return () => { dialogListeners.delete(listener); }; }
/** A React-reactive read of `isAnyDialogOpen()`, for components that must re-render on change. */
export function useAnyDialogOpen(): boolean { return useSyncExternalStore(subscribeDialogOpen, isAnyDialogOpen, () => false); }

export function Dialog({ open, title, children, onClose, variant = 'dialog' }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** 'sheet' slides in from the right edge; behaviour is identical to a dialog. */
  variant?: 'dialog' | 'sheet';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    openDialogCount += 1; notifyDialogListeners();
    return () => { openDialogCount -= 1; notifyDialogListeners(); };
  }, [open]);
  useEffect(() => {
    if (!open)
      return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (!dialog)
      return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]'));
    (dialog.querySelector<HTMLElement>('[data-safe-focus]') ?? focusable()[0] ?? dialog).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const nodes = focusable();
        const first = nodes[0];
        const last = nodes.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener('keydown', key);
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.removeEventListener('keydown', key); document.body.style.overflow = bodyOverflow; previous?.focus(); };
  }, [open]);
  if (!open)
    return null;
  return <div className="ki-dialog-backdrop">
    <div ref={ref} className={variant === 'sheet' ? 'ki-dialog ki-sheet' : 'ki-dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>
        {title}
      </h2>
      {children}
    </div>
  </div>;
}
