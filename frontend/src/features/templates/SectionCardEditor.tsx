import { useId } from 'react';
import type { MissingBehavior, SectionFormat } from '../../api/types';
import { Icon } from '../../components/Icon';
import { blankField, slugFor, type EditorSection } from './editorState';
import { fieldPath, LIMITS, sectionErrorCount, sectionPath, type ValidationErrors } from './validation';

const MISSING_HELP: Record<MissingBehavior, string> = {
  omit: 'Hidden from the final note if the transcript has nothing relevant.',
  state_not_discussed: 'Shown as “Not discussed.” if the transcript has nothing relevant.',
  use_normal_defaults: 'Anything not mentioned is filled with the normal defaults below, flagged for the vet to confirm. Abnormal findings always override.',
};

interface Props {
  section: EditorSection;
  index: number;
  total: number;
  otherIds: string[];
  errors: ValidationErrors;
  readOnly: boolean;
  onChange: (next: EditorSection) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}

export function SectionCardEditor({ section: s, index, total, otherIds, errors, readOnly, onChange, onMove, onRemove }: Props) {
  const uid = useId();
  const errCount = sectionErrorCount(errors, index);
  const open = s.open || errCount > 0;
  const err = (rest: string) => errors[sectionPath(index, rest)];
  const set = (patch: Partial<EditorSection>) => onChange({ ...s, ...patch });
  const label = s.title.trim() || `Section ${index + 1}`;

  function setTitle(title: string) {
    set(s.idEdited ? { title } : { title, id: slugFor(title, 'section', otherIds) });
  }
  function setFormat(format: SectionFormat) {
    const fields = format === 'key_value' && s.fields.length === 0 ? [blankField([])] : s.fields;
    set({ format, fields });
  }

  return (
    <li className={`card sec-card ${errCount ? 'has-errors' : ''}`}>
      <div className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} aria-controls={`${uid}-body`} onClick={() => set({ open: !s.open })}>
          <Icon name="chevron" size={16} style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform .12s' }} />
          <span className="sec-num">{index + 1}</span>
          <span className="sec-title-text">{label}</span>
          <span className="badge">{s.format.replace('_', ' ')}</span>
          {s.required && <span className="badge badge-accent">Required</span>}
          {errCount > 0 && <span className="badge badge-danger">{errCount} issue{errCount === 1 ? '' : 's'}</span>}
        </button>
        {!readOnly && (
          <div className="inline-actions">
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <Icon name="up" size={16} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Move ${label} down`} disabled={index === total - 1} onClick={() => onMove(1)}>
              <Icon name="down" size={16} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm danger" aria-label={`Remove ${label}`} onClick={onRemove}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        )}
      </div>

      {open && (
        <fieldset className="sec-body stack-sm" id={`${uid}-body`} disabled={readOnly}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor={`${uid}-title`}>
                Title <span className="req" aria-hidden="true">*</span>
              </label>
              <input id={`${uid}-title`} type="text" value={s.title} maxLength={LIMITS.titleMax + 20} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!err('title')} aria-describedby={err('title') ? `${uid}-title-e` : undefined} />
              {err('title') && <span className="error" id={`${uid}-title-e`}>{err('title')}</span>}
            </div>
            <div className="field">
              <label htmlFor={`${uid}-id`}>Section id</label>
              <input
                id={`${uid}-id`}
                type="text"
                className="mono"
                value={s.id}
                onChange={(e) => set({ id: e.target.value, idEdited: true })}
                aria-invalid={!!err('id')}
                aria-describedby={err('id') ? `${uid}-id-e` : `${uid}-id-h`}
                spellCheck={false}
              />
              {err('id') ? (
                <span className="error" id={`${uid}-id-e`}>{err('id')}</span>
              ) : (
                <span className="hint" id={`${uid}-id-h`}>{s.idEdited ? 'Custom id.' : 'Auto-generated from the title; edit to override.'}</span>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor={`${uid}-instr`}>Instructions for the AI</label>
            <textarea id={`${uid}-instr`} rows={3} value={s.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="What belongs in this section? e.g. History, presenting complaint, owner observations…" aria-invalid={!!err('instructions')} />
            {err('instructions') && <span className="error">{err('instructions')}</span>}
          </div>

          <div className="grid-3">
            <div className="field">
              <label htmlFor={`${uid}-format`}>Format</label>
              <select id={`${uid}-format`} value={s.format} onChange={(e) => setFormat(e.target.value as SectionFormat)}>
                <option value="paragraph">Paragraph</option>
                <option value="bullets">Bullet list</option>
                <option value="key_value">Key / value fields</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${uid}-mb`}>If not discussed</label>
              <select id={`${uid}-mb`} value={s.missing_behavior} onChange={(e) => set({ missing_behavior: e.target.value as MissingBehavior })} aria-describedby={`${uid}-mb-h`}>
                <option value="omit">Omit section</option>
                <option value="state_not_discussed">State “Not discussed”</option>
                <option value="use_normal_defaults">Use normal defaults</option>
              </select>
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="check" style={{ minHeight: 36 }}>
                <input type="checkbox" checked={s.required} onChange={(e) => set({ required: e.target.checked })} />
                Required section
              </label>
            </div>
          </div>
          <p className="hint muted small" id={`${uid}-mb-h`}>
            {MISSING_HELP[s.missing_behavior]}
          </p>

          {s.missing_behavior === 'use_normal_defaults' && (
            <div className="field">
              <label htmlFor={`${uid}-nd`}>Normal defaults</label>
              <textarea id={`${uid}-nd`} rows={2} value={s.normal_defaults} onChange={(e) => set({ normal_defaults: e.target.value })} placeholder="e.g. BAR, MM pink & moist, CRT < 2s" />
            </div>
          )}

          {s.format === 'key_value' && (
            <fieldset className="fields-editor">
              <legend className="label">Fields</legend>
              {err('fields') && <span className="error" role="alert">{err('fields')}</span>}
              <ul className="fields-list">
                {s.fields.map((f, j) => {
                  const takenKeys = s.fields.filter((_, k) => k !== j).map((x) => x.key);
                  const setField = (patch: Partial<typeof f>) => set({ fields: s.fields.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
                  return (
                    <li key={f.uid} className="field-row">
                      <div className="field">
                        <label htmlFor={`${uid}-f${j}-label`}>Label</label>
                        <input
                          id={`${uid}-f${j}-label`}
                          type="text"
                          value={f.label}
                          placeholder="Weight"
                          onChange={(e) => setField(f.keyEdited ? { label: e.target.value } : { label: e.target.value, key: slugFor(e.target.value, 'field', takenKeys) })}
                          aria-invalid={!!errors[fieldPath(index, j, 'label')]}
                        />
                        {errors[fieldPath(index, j, 'label')] && <span className="error">{errors[fieldPath(index, j, 'label')]}</span>}
                      </div>
                      <div className="field">
                        <label htmlFor={`${uid}-f${j}-key`}>Key</label>
                        <input
                          id={`${uid}-f${j}-key`}
                          type="text"
                          className="mono"
                          value={f.key}
                          spellCheck={false}
                          onChange={(e) => setField({ key: e.target.value, keyEdited: true })}
                          aria-invalid={!!errors[fieldPath(index, j, 'key')]}
                        />
                        {errors[fieldPath(index, j, 'key')] && <span className="error">{errors[fieldPath(index, j, 'key')]}</span>}
                      </div>
                      <div className="field">
                        <label htmlFor={`${uid}-f${j}-hint`}>Hint</label>
                        <input id={`${uid}-f${j}-hint`} type="text" value={f.hint} placeholder="kg or lb as stated" onChange={(e) => setField({ hint: e.target.value })} />
                      </div>
                      {!readOnly && (
                        <button type="button" className="btn btn-ghost btn-icon btn-sm danger field-remove" aria-label={`Remove field ${f.label || j + 1}`} onClick={() => set({ fields: s.fields.filter((_, k) => k !== j) })}>
                          <Icon name="x" size={16} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!readOnly && (
                <button type="button" className="btn btn-sm" onClick={() => set({ fields: [...s.fields, blankField(s.fields.map((x) => x.key))] })}>
                  <Icon name="plus" size={14} /> Add field
                </button>
              )}
            </fieldset>
          )}
        </fieldset>
      )}
    </li>
  );
}

