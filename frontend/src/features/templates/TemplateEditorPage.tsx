import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { useCreateTemplate, useDuplicateTemplate, useTemplate, useUpdateTemplate } from '../../api/hooks';
import { ApiError } from '../../api/client';
import { APPOINTMENT_TYPES, SPECIES, type Species, type Template } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Callout, EmptyState, ErrorState, LoadingBlock, PageHead } from '../../components/ui';
import { humanise } from '../../lib/format';
import { blankSection, blankState, stateFromTemplate, stateToInput, type EditorState } from './editorState';
import { SectionCardEditor } from './SectionCardEditor';
import { TemplatePreview } from './TemplatePreview';
import { LIMITS, toTemplateInput, validateTemplate } from './validation';

export function TemplateEditorPage() {
  const { id } = useParams();
  const query = useTemplate(id);

  if (!id) return <TemplateEditor key="new" initial={null} />;
  if (query.isLoading) return <div className="page"><LoadingBlock label="Loading template…" /></div>;
  if (query.isError || !query.data) {
    const nf = query.error instanceof ApiError && query.error.isNotFound;
    return (
      <div className="page">
        {nf ? (
          <EmptyState icon="template" title="Template not found" action={<Link className="btn" to="/templates">Back to templates</Link>} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Couldn’t load template" />
        )}
      </div>
    );
  }
  return <TemplateEditor key={`${query.data.id}-${query.data.version}`} initial={query.data} />;
}

function TemplateEditor({ initial }: { initial: Template | null }) {
  const uid = useId();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateTemplate();
  const update = useUpdateTemplate(initial?.id ?? '');
  const duplicate = useDuplicateTemplate();

  const readOnly = !!initial?.is_builtin;
  const [state, setState] = useState<EditorState>(() => (initial ? stateFromTemplate(initial) : blankState()));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toTemplateInput(stateToInput(state))));

  const input = useMemo(() => stateToInput(state), [state]);
  const { valid, errors } = useMemo(() => validateTemplate(input), [input]);
  const dirty = !readOnly && JSON.stringify(toTemplateInput(input)) !== baseline;
  const saving = create.isPending || update.isPending;

  // Unsaved-changes guard (in-app navigation + tab close).
  const guard = useRef(false);
  useEffect(() => {
    guard.current = dirty;
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => guard.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (guard.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const patch = (p: Partial<EditorState>) => setState((s) => ({ ...s, ...p }));
  const setSection = (i: number, next: EditorState['sections'][number]) => setState((s) => ({ ...s, sections: s.sections.map((x, j) => (j === i ? next : x)) }));

  function move(i: number, dir: -1 | 1) {
    setState((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.sections.length) return s;
      const sections = [...s.sections];
      [sections[i], sections[j]] = [sections[j], sections[i]];
      return { ...s, sections };
    });
  }

  function addSection() {
    setState((s) => ({ ...s, sections: [...s.sections, blankSection(s.sections.map((x) => x.id))] }));
  }

  function toggleSpecies(sp: Species) {
    patch({ species: state.species.includes(sp) ? state.species.filter((x) => x !== sp) : [...state.species, sp] });
  }

  function onSave() {
    if (!valid || readOnly) return;
    const body = toTemplateInput(input);
    const done = (t: Template, msg: string) => {
      guard.current = false;
      setBaseline(JSON.stringify(body));
      toast.show(msg);
      if (!initial) void navigate(`/templates/${t.id}`, { replace: true });
    };
    if (initial) update.mutate(body, { onSuccess: (t) => done(t, 'Template saved'), onError: (e) => toast.show(e.message, 'error') });
    else create.mutate(body, { onSuccess: (t) => done(t, 'Template created'), onError: (e) => toast.show(e.message, 'error') });
  }

  const saveError = (create.error ?? update.error) as ApiError | null;
  const issueCount = Object.keys(errors).length;

  return (
    <div className="page page-wide">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/templates">Templates</Link> <span aria-hidden="true">/</span> <span aria-current="page">{initial ? initial.name : 'New template'}</span>
      </nav>
      <PageHead
        title={readOnly ? 'View template' : initial ? 'Edit template' : 'New template'}
        subtitle={initial && !readOnly ? `Version ${initial.version}` : undefined}
        actions={
          readOnly ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={duplicate.isPending}
              onClick={() =>
                duplicate.mutate(
                  { id: initial.id },
                  { onSuccess: (c) => void navigate(`/templates/${c.id}`), onError: (e) => toast.show(e.message, 'error') },
                )
              }
            >
              <Icon name="copy" size={16} /> Duplicate to edit
            </button>
          ) : (
            <>
              <Link to="/templates" className="btn">
                Cancel
              </Link>
              <button type="button" className="btn btn-primary" disabled={!valid || saving || (!!initial && !dirty)} onClick={onSave}>
                {saving ? 'Saving…' : initial ? 'Save template' : 'Create template'}
              </button>
            </>
          )
        }
      />

      {readOnly && (
        <Callout kind="info" icon="lock" title="Built-in template">
          <p>Built-in templates are read-only. Duplicate this one to make your own copy you can edit.</p>
        </Callout>
      )}
      {saveError && (
        <Callout kind="danger" role="alert" title="Couldn’t save template">
          <p>{saveError.message}</p>
        </Callout>
      )}
      {!readOnly && issueCount > 0 && (
        <p className="muted small" role="status">
          {issueCount} issue{issueCount === 1 ? '' : 's'} to fix before saving.
        </p>
      )}

      <div className="editor-layout">
        <div className="stack">
          <fieldset className="card card-pad stack-sm" disabled={readOnly}>
            <legend className="section-title legend-title">Details</legend>
            <div className="field">
              <label htmlFor={`${uid}-name`}>
                Name <span className="req" aria-hidden="true">*</span>
              </label>
              <input id={`${uid}-name`} type="text" value={state.name} onChange={(e) => patch({ name: e.target.value })} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${uid}-name-e` : undefined} />
              {errors.name && <span className="error" id={`${uid}-name-e`}>{errors.name}</span>}
            </div>
            <div className="field">
              <label htmlFor={`${uid}-desc`}>Description</label>
              <textarea id={`${uid}-desc`} rows={2} value={state.description} onChange={(e) => patch({ description: e.target.value })} aria-invalid={!!errors.description} />
              <span className="hint">
                {state.description.length}/{LIMITS.descriptionMax}
              </span>
              {errors.description && <span className="error">{errors.description}</span>}
            </div>
            <div className="field" style={{ maxWidth: 280 }}>
              <label htmlFor={`${uid}-appt`}>Appointment type</label>
              <select id={`${uid}-appt`} value={state.appointment_type} onChange={(e) => patch({ appointment_type: e.target.value as EditorState['appointment_type'] })}>
                {APPOINTMENT_TYPES.map((a) => (
                  <option key={a} value={a}>
                    {humanise(a)}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="field">
              <legend className="label">Species</legend>
              <div className="chips">
                {SPECIES.map((sp) => (
                  <label key={sp} className="chip">
                    <input type="checkbox" checked={state.species.includes(sp)} onChange={() => toggleSpecies(sp)} />
                    {humanise(sp)}
                  </label>
                ))}
              </div>
              <span className="hint">Leave all unselected for “any species”.</span>
            </fieldset>
          </fieldset>

          <fieldset className="card card-pad stack-sm" disabled={readOnly}>
            <legend className="section-title legend-title">Style</legend>
            <fieldset className="field">
              <legend className="label">Tone</legend>
              <div className="check-row">
                <label className="check">
                  <input type="radio" name={`${uid}-tone`} checked={state.style.tone === 'clinical'} onChange={() => patch({ style: { ...state.style, tone: 'clinical' } })} />
                  Clinical
                </label>
                <label className="check">
                  <input type="radio" name={`${uid}-tone`} checked={state.style.tone === 'client_friendly'} onChange={() => patch({ style: { ...state.style, tone: 'client_friendly' } })} />
                  Client-friendly
                </label>
              </div>
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={state.style.use_abbreviations} onChange={(e) => patch({ style: { ...state.style, use_abbreviations: e.target.checked } })} />
              Use veterinary abbreviations (BAR, MM, CRT, q12h…)
            </label>
            <div className="field">
              <label htmlFor={`${uid}-ci`}>Custom instructions</label>
              <textarea id={`${uid}-ci`} rows={3} value={state.style.custom_instructions} onChange={(e) => patch({ style: { ...state.style, custom_instructions: e.target.value } })} placeholder="Free-text style guide, e.g. “Write doses as mg/kg. Avoid first person.”" aria-invalid={!!errors.custom_instructions} />
              <span className="hint">
                {state.style.custom_instructions.length}/{LIMITS.customInstructionsMax}
              </span>
              {errors.custom_instructions && <span className="error">{errors.custom_instructions}</span>}
            </div>
          </fieldset>

          <section className="stack-sm" aria-label="Sections">
            <div className="row-between">
              <h2 className="section-title">Sections ({state.sections.length})</h2>
              {!readOnly && (
                <button type="button" className="btn btn-sm" onClick={addSection} disabled={state.sections.length >= LIMITS.sectionsMax}>
                  <Icon name="plus" size={14} /> Add section
                </button>
              )}
            </div>
            {errors.sections && (
              <span className="error" role="alert">
                {errors.sections}
              </span>
            )}
            <ol className="sec-list">
              {state.sections.map((s, i) => (
                <SectionCardEditor
                  key={s.uid}
                  section={s}
                  index={i}
                  total={state.sections.length}
                  otherIds={state.sections.filter((_, j) => j !== i).map((x) => x.id)}
                  errors={errors}
                  readOnly={readOnly}
                  onChange={(next) => setSection(i, next)}
                  onMove={(d) => move(i, d)}
                  onRemove={() => setState((st) => ({ ...st, sections: st.sections.filter((_, j) => j !== i) }))}
                />
              ))}
            </ol>
            {!readOnly && state.sections.length > 0 && (
              <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addSection} disabled={state.sections.length >= LIMITS.sectionsMax}>
                <Icon name="plus" size={14} /> Add section
              </button>
            )}
          </section>
        </div>

        <div className="preview-col">
          <TemplatePreview state={state} />
        </div>
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        confirmLabel="Discard changes"
        danger
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        <p>You have unsaved changes to this template. If you leave now they will be lost.</p>
      </ConfirmDialog>
    </div>
  );
}
