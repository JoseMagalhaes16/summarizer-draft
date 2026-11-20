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
}: {
  templates: Template[];
  value: string | null;
  onChange: (id: string) => void;
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
      <div className="picker-grid" role="radiogroup" aria-label="Template">
        {shown.map((t) => (
          <label key={t.id} className={`picker-card ${t.id === value ? 'selected' : ''}`}>
            <input type="radio" name={name} value={t.id} checked={t.id === value} onChange={() => onChange(t.id)} />
            <span className="picker-title">{t.name}</span>
            <span className="picker-meta">
              <span className="badge">{humanise(t.appointment_type)}</span>
              <span className="faint">
                {t.species.length ? t.species.join(', ') : 'Any species'} · {t.sections.length} section{t.sections.length === 1 ? '' : 's'}
              </span>
            </span>
            {t.description && <span className="picker-desc">{t.description}</span>}
          </label>
        ))}
        {shown.length === 0 && <p className="muted">No templates match “{q}”.</p>}
      </div>
    </div>
  );
}
