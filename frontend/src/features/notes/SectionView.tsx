import type { ResultSection } from '../../api/types';

/** Read-only body of a section, rendered by its format. */
export function SectionBody({ section, behavior }: { section: ResultSection; behavior?: string }) {
  if (section.not_discussed) {
    return <p className="muted not-discussed">{behavior === 'omit' ? 'Not discussed (hidden from the final note).' : 'Not discussed.'}</p>;
  }
  switch (section.format) {
    case 'paragraph':
      return section.content.trim() ? (
        <p className="prose">{section.content}</p>
      ) : (
        <p className="muted not-discussed">No content.</p>
      );
    case 'bullets':
      return section.items.length ? (
        <ul className="bullets">
          {section.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : (
        <p className="muted not-discussed">No items.</p>
      );
    case 'key_value':
      return section.fields.length ? (
        <dl className="kv">
          {section.fields.map((f) => (
            <div className="kv-row" key={f.key}>
              <dt>{f.label}</dt>
              <dd className={f.value.trim() ? '' : 'faint'}>{f.value.trim() || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted not-discussed">No fields.</p>
      );
  }
}
