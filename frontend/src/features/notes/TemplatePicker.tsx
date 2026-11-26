import { useId, useMemo, useState } from 'react';
import type { Template } from '../../api/types';
import { humanise } from '../../lib/format';

export function templateMatches(t: Template, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [t.name, t.description, t.appointment_type, ...t.species].some((s) => s.toLowerCase().includes(needle));
}

export function TemplatePicker({
  templates,
  value,
  onChange,
  currentId,
}: {
  templates: Template[];
  value: string | null;
  onChange: (id: string) => void;
  /** Marks this template as "Current" (e.g. the one an existing note used). */
  currentId?: string;
}) {
  const [q, setQ] = useState('');
  const name = useId();
  const shown = useMemo(() => templates.filter((t) => templateMatches(t, q) || t.id === value), [templates, q, value]);

  return (
    <div className="picker">
      {templates.length > 5 && (
        <div className="field picker-search">
          <label htmlFor={`${name}-q`} className="sr-only">
            Search templates
          </label>
          <input id={`${name}-q`} type="search" placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="picker-list" role="radiogroup" aria-label="Template">
        {shown.map((t) => (
          <label key={t.id} className={`picker-row ${t.id === value ? 'selected' : ''}`}>
            <input type="radio" name={name} value={t.id} checked={t.id === value} onChange={() => onChange(t.id)} />
            <span className="picker-title">
              {t.name}
              {t.id === currentId && <span className="badge picker-current">Current</span>}
            </span>
            <span className="picker-desc">{t.description || `${humanise(t.appointment_type)} visit`}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="muted">No templates match “{q}”. Clear the search to see them all.</p>}
      </div>
    </div>
  );
}
