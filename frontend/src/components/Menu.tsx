import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Menu({
  label,
  children,
  align = 'left',
  buttonClassName = 'btn btn-sm',
}: {
  label: string;
  /** Render function receives close(). */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className={`menu ${align === 'right' ? 'align-right' : ''}`} id={id} role="group" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
