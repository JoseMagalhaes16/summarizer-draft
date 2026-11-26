import { useId } from 'react';
import type { ResultSection } from '../../api/types';
import { Icon } from '../../components/Icon';

export function sectionHasContent(s: ResultSection): boolean {
  if (s.format === 'paragraph') return s.content.trim() !== '';
  if (s.format === 'bullets') return s.items.some((i) => i.trim() !== '');
  return s.fields.some((f) => f.value.trim() !== '');
}

/** Inline editor for one section; emits a new section object on every change. */
export function SectionEditor({ section, onChange }: { section: ResultSection; onChange: (s: ResultSection) => void }) {
  const uid = useId();
  // Typing content into a "not discussed" section makes it discussed.
  const commit = (next: ResultSection) => onChange({ ...next, not_discussed: sectionHasContent(next) ? false : next.not_discussed });

  if (section.format === 'paragraph') {
    return (
      <div className="field">
        <label htmlFor={`${uid}-p`} className="sr-only">
          {section.title}
        </label>
        <textarea id={`${uid}-p`} rows={Math.max(4, Math.ceil(section.content.length / 90) + 1)} value={section.content} onChange={(e) => commit({ ...section, content: e.target.value })} />
      </div>
    );
  }

  if (section.format === 'bullets') {
    const items = section.items;
    const setItem = (i: number, v: string) => commit({ ...section, items: items.map((x, j) => (j === i ? v : x)) });
    return (
      <div className="list-editor">
        <ul>
          {items.map((it, i) => (
            <li key={i}>
              <label htmlFor={`${uid}-${i}`} className="sr-only">
                {section.title} item {i + 1}
              </label>
              <input id={`${uid}-${i}`} type="text" value={it} onChange={(e) => setItem(i, e.target.value)} />
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove ${section.title} item ${i + 1}`} onClick={() => commit({ ...section, items: items.filter((_, j) => j !== i) })}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...section, items: [...items, ''] })}>
          <Icon name="plus" size={14} /> Add item
        </button>
      </div>
    );
  }

  return (
    <div className="kv-editor">
      {section.fields.map((f, i) => (
        <div className="field kv-edit-row" key={f.key}>
          <label htmlFor={`${uid}-${f.key}`}>{f.label}</label>
          <input
            id={`${uid}-${f.key}`}
            type="text"
            value={f.value}
            onChange={(e) => commit({ ...section, fields: section.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
          />
        </div>
      ))}
    </div>
  );
}
