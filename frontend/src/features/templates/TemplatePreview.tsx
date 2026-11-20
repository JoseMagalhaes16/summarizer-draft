import type { MissingBehavior } from '../../api/types';
import { RecordSheet, SheetEntry } from '../../components/RecordSheet';
import type { EditorState } from './editorState';

const PLACEHOLDER_PARA = 'Generated text appears here, written in the template’s tone from facts in the transcript.';

const MB_NOTE: Record<MissingBehavior, string> = {
  omit: 'Left out if not discussed',
  state_not_discussed: 'Says “Not discussed” if missing',
  use_normal_defaults: 'Uses normal defaults if missing',
};

/** Live preview of the note this template will produce, drawn with the same record sheet as a real note. */
export function TemplatePreview({ state }: { state: EditorState }) {
  return (
    <aside aria-label="Note preview" className="preview">
      <RecordSheet label="Preview of the note">
        <SheetEntry title="Summary" lead>
          <p className="not-discussed">One-sentence summary of the visit.</p>
        </SheetEntry>
        {state.sections.map((s) => (
          <SheetEntry
            key={s.uid}
            title={s.title.trim() || 'Untitled section'}
            flag={s.missing_behavior === 'use_normal_defaults' ? 'Normal defaults: confirm' : undefined}
            meta={
              <>
                {s.required && <div>Required</div>}
                <div>{MB_NOTE[s.missing_behavior]}</div>
              </>
            }
          >
            {s.format === 'paragraph' && <p className="prose not-discussed">{PLACEHOLDER_PARA}</p>}
            {s.format === 'bullets' && (
              <ul className="bullets not-discussed">
                <li>First point from the transcript</li>
                <li>Second point from the transcript</li>
              </ul>
            )}
            {s.format === 'key_value' &&
              (s.fields.length === 0 ? (
                <p className="not-discussed">No fields yet.</p>
              ) : (
                <dl className="kv">
                  {s.fields.map((f) => (
                    <div className="kv-row" key={f.uid}>
                      <dt>{f.label.trim() || 'Unlabelled'}</dt>
                      <dd>
                        <span className="not-stated">{f.hint.trim() || 'value'}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            {s.missing_behavior === 'use_normal_defaults' && s.normal_defaults.trim() && <p className="small muted">Default: {s.normal_defaults.trim()}</p>}
          </SheetEntry>
        ))}
      </RecordSheet>
    </aside>
  );
}
