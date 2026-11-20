import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { isActive, useDeleteNote, useNote, useRegenerateNote, useTemplates, useUpdateNote } from '../../api/hooks';
import { ApiError } from '../../api/client';
import type { Note, NoteResult, ResultSection } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Callout, EmptyState, ErrorState, LoadingBlock, Skeleton, StatusBadge } from '../../components/ui';
import { formatDateTime, formatNumber, humanise, patientLabel } from '../../lib/format';
import { fullNoteText, isOmitted, missingBehaviors, renderSectionText } from '../../lib/renderNote';
import { SectionBody } from './SectionView';
import { SectionEditor } from './SectionEditor';
import { useElapsedSeconds } from './useElapsed';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function NotePage() {
  const { id } = useParams();
  const query = useNote(id);
  const note = query.data;

  if (query.isLoading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading note…" />
      </div>
    );
  }
  if (query.isError || !note) {
    const nf = query.error instanceof ApiError && query.error.isNotFound;
    return (
      <div className="page">
        {nf ? (
          <EmptyState title="Note not found" action={<Link className="btn" to="/notes">Back to notes</Link>}>
            It may have been deleted.
          </EmptyState>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Couldn’t load note" />
        )}
      </div>
    );
  }
  return <NoteView key={note.id} note={note} />;
}

function NoteView({ note }: { note: Note }) {
  const navigate = useNavigate();
  const toast = useToast();
  const templates = useTemplates();
  const update = useUpdateNote(note.id);
  const regenerate = useRegenerateNote(note.id);
  const del = useDeleteNote();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoteResult | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTemplate, setRegenTemplate] = useState(note.template_id);

  const active = isActive(note.status);
  const behaviors = useMemo(() => missingBehaviors(note.template_snapshot), [note.template_snapshot]);

  function startEdit() {
    if (!note.result) return;
    setDraft(structuredClone(note.result));
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }
  function saveEdit() {
    if (!draft) return;
    const cleaned: NoteResult = {
      ...draft,
      action_items: draft.action_items.filter((a) => a.trim()),
      sections: draft.sections.map((sec) => ({ ...sec, items: sec.items.filter((i) => i.trim()) })),
    };
    update.mutate(cleaned, {
      onSuccess: () => {
        setEditing(false);
        setDraft(null);
        toast.show('Changes saved');
      },
      onError: (e) => toast.show(e instanceof Error ? e.message : 'Save failed', 'error'),
    });
  }
  function doRegenerate() {
    regenerate.mutate(regenTemplate !== note.template_id ? regenTemplate : undefined, {
      onSuccess: () => {
        setRegenOpen(false);
        setEditing(false);
        setDraft(null);
      },
      onError: (e) => toast.show(e instanceof Error ? e.message : 'Regenerate failed', 'error'),
    });
  }
  function doDelete() {
    del.mutate(note.id, {
      onSuccess: () => void navigate('/notes', { replace: true }),
      onError: (e) => {
        setConfirmDelete(false);
        toast.show(e instanceof Error ? e.message : 'Delete failed', 'error');
      },
    });
  }
  async function copy(text: string, what: string) {
    const ok = await copyToClipboard(text);
    toast.show(ok ? `${what} copied to clipboard` : 'Copy failed — select the text and copy manually', ok ? 'info' : 'error');
  }

  const result = editing && draft ? draft : note.result;
  const completed = note.status === 'completed' && !!result;
  const shownSections = result?.sections ?? [];
  const hiddenCount = editing ? 0 : shownSections.filter((s) => isOmitted(s, behaviors)).length;

  return (
    <div className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/notes">Notes</Link> <span aria-hidden="true">/</span> <span aria-current="page">{patientLabel(note.patient)}</span>
      </nav>

      <header className="note-head card card-pad">
        <div className="note-head-main">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h1>{patientLabel(note.patient)}</h1>
            <StatusBadge status={note.status} />
            {note.edited && <span className="badge badge-info">Edited</span>}
          </div>
          <p className="muted">{[note.patient.species, note.patient.breed, note.patient.age, note.patient.sex, note.patient.weight].filter(Boolean).join(' · ') || 'No patient details'}</p>
          <p className="muted small">
            {note.template_name} · {formatDateTime(note.created_at)}
            {note.clinician ? ` · ${note.clinician}` : ''}
          </p>
        </div>
        <div className="page-actions">
          {completed && !editing && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => void copy(fullNoteText(note), 'Full note')}>
                <Icon name="copy" size={16} /> Copy full note
              </button>
              <button type="button" className="btn" onClick={startEdit}>
                <Icon name="edit" size={16} /> Edit
              </button>
            </>
          )}
          {editing && (
            <>
              <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="btn" onClick={cancelEdit} disabled={update.isPending}>
                Cancel
              </button>
            </>
          )}
          {!editing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRegenTemplate(note.template_id);
                setRegenOpen(true);
              }}
              disabled={active}
            >
              <Icon name="refresh" size={16} /> Regenerate
            </button>
          )}
          <button type="button" className="btn btn-ghost danger" onClick={() => setConfirmDelete(true)} disabled={editing}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      </header>

      {active && <Progress note={note} />}

      {note.status === 'failed' && (
        <Callout
          kind="danger"
          role="alert"
          title={`Generation failed${note.error?.code ? ` (${note.error.code})` : ''}`}
          actions={
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setRegenTemplate(note.template_id);
                setRegenOpen(true);
              }}
            >
              <Icon name="refresh" size={14} /> Regenerate
            </button>
          }
        >
          <p>{note.error?.message ?? 'The note could not be generated.'}</p>
        </Callout>
      )}

      {completed && result && (
        <>
          <section className="card card-pad summary" aria-label="Visit summary">
            <h2 className="eyebrow">Visit summary</h2>
            {editing ? (
              <div className="field">
                <label htmlFor="summary-edit" className="sr-only">
                  Visit summary
                </label>
                <textarea id="summary-edit" rows={2} value={result.visit_summary} onChange={(e) => setDraft({ ...result, visit_summary: e.target.value })} />
              </div>
            ) : (
              <p className="summary-text">{result.visit_summary}</p>
            )}
          </section>

          {result.review_flags.length > 0 && (
            <section aria-label="Needs vet review" className="stack-sm">
              {result.review_flags.map((f, i) => (
                <Callout key={i} kind="warn" icon="alert" title="Needs vet review">
                  <p>{f}</p>
                </Callout>
              ))}
            </section>
          )}

          <div className="stack">
            {shownSections.map((s, idx) => {
              const behavior = behaviors[s.section_id];
              const omitted = isOmitted(s, behaviors);
              if (omitted && !showEmpty && !editing) return null;
              return (
                <SectionCard
                  key={s.section_id}
                  section={s}
                  behavior={behavior}
                  editing={editing}
                  muted={omitted || s.not_discussed}
                  onChange={(next) => setDraft({ ...result, sections: result.sections.map((x, i) => (i === idx ? next : x)) })}
                  onCopy={() => void copy(renderSectionText(s, behaviors), `“${s.title}”`)}
                />
              );
            })}
          </div>

          {hiddenCount > 0 && (
            <button type="button" className="btn btn-ghost toggle-empty" onClick={() => setShowEmpty((v) => !v)} aria-pressed={showEmpty}>
              {showEmpty ? 'Hide empty sections' : `Show empty sections (${hiddenCount})`}
            </button>
          )}

          <section className="card card-pad stack-sm" aria-label="Action items">
            <h2 className="eyebrow">Action items</h2>
            {editing ? (
              <ActionItemsEditor items={result.action_items} onChange={(action_items) => setDraft({ ...result, action_items })} />
            ) : result.action_items.length ? (
              <ul className="checklist">
                {result.action_items.map((a, i) => (
                  <li key={i}>
                    <label className="check">
                      <input type="checkbox" />
                      <span>{a}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No action items.</p>
            )}
          </section>
        </>
      )}

      <details className="card card-pad collapse transcript-box">
        <summary>Original transcript</summary>
        <pre className="transcript-pre">{note.transcript}</pre>
      </details>

      {note.model_info && (
        <footer className="model-info faint small">
          <span>Provider: {note.model_info.provider}</span>
          <span>Model: {note.model_info.model_id}</span>
          <span>Tokens: {formatNumber(note.model_info.input_tokens)} in / {formatNumber(note.model_info.output_tokens)} out</span>
          <span>Latency: {(note.model_info.latency_ms / 1000).toFixed(1)} s</span>
        </footer>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        confirmLabel="Delete note"
        danger
        busy={del.isPending}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>
          The note for <strong>{patientLabel(note.patient)}</strong> and its transcript will be permanently deleted. This can’t be undone.
        </p>
      </ConfirmDialog>

      <ConfirmDialog open={regenOpen} title="Regenerate note" confirmLabel="Regenerate" busy={regenerate.isPending} onConfirm={doRegenerate} onCancel={() => setRegenOpen(false)}>
        <p className="muted">
          This creates a new draft from the original transcript.{note.edited ? ' Your manual edits will be discarded.' : ''}
        </p>
        <div className="field">
          <label htmlFor="regen-template">Template</label>
          <select id="regen-template" value={regenTemplate} onChange={(e) => setRegenTemplate(e.target.value)}>
            {!templates.data?.some((t) => t.id === note.template_id) && <option value={note.template_id}>{note.template_name} (current)</option>}
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.id === note.template_id ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function Progress({ note }: { note: Note }) {
  // Count from creation for a fresh note; otherwise (e.g. regenerate) from when this view appeared.
  const [since] = useState(() => {
    const age = Date.now() - new Date(note.created_at).getTime();
    return age >= 0 && age < 120_000 ? note.created_at : new Date().toISOString();
  });
  const secs = useElapsedSeconds(since, true);
  const sections = note.template_snapshot?.sections ?? [];
  return (
    <section className="stack" aria-label="Generation progress">
      <div className="card card-pad progress" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <div>
          <div style={{ fontWeight: 600 }}>{note.status === 'pending' ? 'Queued…' : 'Drafting your note…'}</div>
          <div className="muted small">
            Elapsed: {secs}s · this usually takes 10–60 seconds. You can leave this page; the note will be in your history.
          </div>
        </div>
      </div>
      {(sections.length ? sections : [null, null, null]).map((s, i) => (
        <div className="card card-pad stack-sm" key={s?.id ?? i} aria-hidden="true">
          <Skeleton width={s ? Math.min(40, 12 + s.title.length * 2) + '%' : '30%'} height={16} />
          <Skeleton />
          <Skeleton width="92%" />
          <Skeleton width="64%" />
        </div>
      ))}
    </section>
  );
}

function SectionCard({
  section,
  behavior,
  editing,
  muted,
  onChange,
  onCopy,
}: {
  section: ResultSection;
  behavior?: string;
  editing: boolean;
  muted: boolean;
  onChange: (s: ResultSection) => void;
  onCopy: () => void;
}) {
  return (
    <section className={`card note-section ${muted ? 'is-muted' : ''}`} aria-label={section.title}>
      <div className="card-head">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <h2>{section.title}</h2>
          <span className="badge">{humanise(section.format)}</span>
          {section.used_defaults && <span className="badge badge-warn">Normal defaults — confirm</span>}
        </div>
        {!editing && !section.not_discussed && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy} aria-label={`Copy section ${section.title}`}>
            <Icon name="copy" size={14} /> Copy section
          </button>
        )}
      </div>
      <div className="card-body">{editing ? <SectionEditor section={section} onChange={onChange} /> : <SectionBody section={section} behavior={behavior} />}</div>
    </section>
  );
}

function ActionItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="list-editor">
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <label htmlFor={`action-${i}`} className="sr-only">
              Action item {i + 1}
            </label>
            <input id={`action-${i}`} type="text" value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove action item ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm" onClick={() => onChange([...items, ''])}>
        <Icon name="plus" size={14} /> Add action item
      </button>
    </div>
  );
}
