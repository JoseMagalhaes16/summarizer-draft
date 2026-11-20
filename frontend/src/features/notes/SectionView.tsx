import type { ResultSection } from '../../api/types';

/** Read-only body of a section, rendered by its format. Never names the format. */
export function SectionBody({ section, behavior }: { section: ResultSection; behavior?: string }) {
  if (section.not_discussed) {
    return <p className="not-discussed">{behavior === 'omit' ? 'Not discussed. Left out when you copy the note.' : 'Not discussed.'}</p>;
  }
  switch (section.format) {
    case 'paragraph':
      return section.content.trim() ? <p className="prose">{section.content}</p> : <p className="not-discussed">Nothing recorded.</p>;
    case 'bullets':
      return section.items.length ? (
        <ul className="bullets">
          {section.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : (
        <p className="not-discussed">Nothing recorded.</p>
      );
    case 'key_value':
      return section.fields.length ? (
        <dl className="kv">
          {section.fields.map((f) => (
            <div className="kv-row" key={f.key}>
              <dt>{f.label}</dt>
              <dd>{f.value.trim() || <span className="not-stated">not stated</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="not-discussed">Nothing recorded.</p>
      );
  }
}
