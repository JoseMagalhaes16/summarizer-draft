import { useId, type ReactNode } from 'react';

export interface Choice<V extends string> {
  value: V;
  title: string;
  desc: ReactNode;
  disabled?: boolean;
}

/** A small radio group where every option has a title and a one-line explanation. */
export function ChoiceCards<V extends string>({
  label,
  value,
  onChange,
  choices,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  choices: Choice<V>[];
}) {
  const name = useId();
  return (
    <div className="choice-list" role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <label key={c.value} className={`choice-row${c.value === value ? ' selected' : ''}${c.disabled ? ' disabled' : ''}`}>
          <input type="radio" name={name} value={c.value} checked={c.value === value} disabled={c.disabled} onChange={() => onChange(c.value)} />
          <span className="choice-title">{c.title}</span>
          <span className="choice-desc">{c.desc}</span>
        </label>
      ))}
    </div>
  );
}
