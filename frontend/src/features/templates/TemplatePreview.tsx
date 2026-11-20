import { Fragment } from 'react';
import type { MissingBehavior } from '../../api/types';
import type { EditorState } from './editorState';

const PLACEHOLDER_PARA = 'Generated paragraph text appears here, written in the template’s tone from facts in the transcript.';

const MB_NOTE: Record<MissingBehavior, string> = {
  omit: 'Hidden if not discussed',
  state_not_discussed: 'Shows “Not discussed.” if missing',
  use_normal_defaults: 'Uses normal defaults if missing',
};

/** Live structural preview of what a generated note will look like. */
export function TemplatePreview({ state }: { state: EditorState }) {
  return (
    <aside className="preview card" aria-label="Note preview">
      <div className="card-head">
        <h2 className="preview-title">Preview</h2>
        <span className="muted small">Placeholder content</span>
      </div>
      <div className="preview-body">
        <div className="preview-meta">
          <strong>{state.name.trim() || 'Untitled template'}</strong>
          <span className="faint small">
            {state.style.tone === 'clinical' ? 'Clinical tone' : 'Client-friendly tone'}
            {state.style.use_abbreviations ? ' · abbreviations on' : ' · no abbreviations'}
          </span>
        </div>
        <div className="preview-summary">
          <span className="eyebrow">Visit summary</span>
          <p>One-sentence summary of the visit used in list views.</p>
        </div>
        {state.sections.map((s) => (
          <section key={s.uid} className="preview-section">
            <h3>
              {s.title.trim() || <span className="faint">Untitled section</span>}
              {s.required && <span className="badge badge-accent">Required</span>}
              {s.missing_behavior === 'use_normal_defaults' && <span className="badge badge-warn">Normal defaults — confirm</span>}
            </h3>
            {s.format === 'paragraph' && <p className="prose faint">{PLACEHOLDER_PARA}</p>}
            {s.format === 'bullets' && (
              <ul className="bullets faint">
                <li>First point from the transcript</li>
                <li>Second point from the transcript</li>
                <li>Third point from the transcript</li>
              </ul>
            )}
            {s.format === 'key_value' && (
              <dl className="kv">
                {s.fields.length === 0 && <p className="faint small">No fields yet.</p>}
                {s.fields.map((f) => (
                  <Fragment key={f.uid}>
                    <div className="kv-row">
                      <dt>{f.label.trim() || <span className="faint">Unlabelled</span>}</dt>
                      <dd className="faint">{f.hint.trim() || 'value'}</dd>
                    </div>
                  </Fragment>
                ))}
              </dl>
            )}
            {s.missing_behavior === 'use_normal_defaults' && s.normal_defaults.trim() && <p className="small preview-defaults">Default: {s.normal_defaults.trim()}</p>}
            <p className="preview-mb">{MB_NOTE[s.missing_behavior]}</p>
          </section>
        ))}
        <section className="preview-section">
          <h3>Action items</h3>
          <ul className="bullets faint">
            <li>Follow-up or owner to-do</li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
