import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * The "record sheet": one continuous page with ruled entries, headings in a left
 * margin column and annotations beside the entry they refer to. Used for the
 * generated note and for the template preview, so both look the same.
 * Layout adapts to the sheet's own width (container query), not the viewport.
 */
export function RecordSheet({ label, head, children }: { label: string; head?: ReactNode; children: ReactNode }) {
  return (
    <div className="sheet-wrap">
      <article className="sheet" aria-label={label}>
        {head && <div className="sheet-head">{head}</div>}
        {children}
      </article>
    </div>
  );
}

export function SheetEntry({
  id,
  title,
  flag,
  meta,
  muted,
  lead,
  onCopy,
  children,
}: {
  /** DOM id (for in-page links from the review rail). */
  id?: string;
  title: string;
  /** Margin annotation, e.g. "Normal defaults: confirm". */
  flag?: string;
  /** Quiet margin detail. */
  meta?: ReactNode;
  muted?: boolean;
  /** Larger body text (used for the summary). */
  lead?: boolean;
  onCopy?: () => void;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-h` : undefined;
  return (
    <section id={id} className={`entry${muted ? ' is-muted' : ''}${lead ? ' is-lead' : ''}`} aria-labelledby={headingId} aria-label={headingId ? undefined : title}>
      <div className="entry-margin">
        <h2 className="entry-title" id={headingId}>
          {title}
        </h2>
        {flag && (
          <span className="entry-flag">
            <Icon name="alert" size={13} />
            {flag}
          </span>
        )}
        {meta && <div className="entry-meta">{meta}</div>}
        {onCopy && (
          <button type="button" className="btn btn-ghost btn-sm entry-copy" onClick={onCopy} aria-label={`Copy ${title}`}>
            <Icon name="copy" size={14} /> Copy
          </button>
        )}
      </div>
      <div className="entry-body">{children}</div>
    </section>
  );
}
