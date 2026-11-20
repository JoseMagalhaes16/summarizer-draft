import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { NoteStatus } from '../api/types';
import { Icon, type IconName } from './Icon';

const STATUS: Record<NoteStatus, { label: string; cls: string; pulse?: boolean }> = {
  pending: { label: 'Queued', cls: 'badge-info', pulse: true },
  processing: { label: 'Generating', cls: 'badge-info', pulse: true },
  completed: { label: 'Completed', cls: 'badge-accent' },
  failed: { label: 'Failed', cls: 'badge-danger' },
};

export function StatusBadge({ status }: { status: NoteStatus }) {
  const s = STATUS[status];
  return (
    <span className={`badge ${s.cls}`}>
      <span className={`dot ${s.pulse ? 'pulse' : ''}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function Skeleton({ width, height = 14, style }: { width?: string | number; height?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ width: width ?? '100%', height, ...style }} aria-hidden="true" />;
}

export function Callout({
  kind = 'info',
  icon,
  title,
  children,
  actions,
  role,
}: {
  kind?: 'info' | 'warn' | 'danger';
  icon?: IconName;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className={`callout callout-${kind}`} role={role}>
      <Icon name={icon ?? (kind === 'info' ? 'info' : 'alert')} />
      <div className="callout-body">
        {title && <div className="callout-title">{title}</div>}
        {children}
        {actions && <div className="callout-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'note', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={36} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Unknown error';
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <Callout
      kind="danger"
      role="alert"
      title={title}
      actions={
        onRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        )
      }
    >
      <p>
        {msg}
        {code && <span className="faint"> ({code})</span>}
      </p>
    </Callout>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 24 }} className="muted">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
