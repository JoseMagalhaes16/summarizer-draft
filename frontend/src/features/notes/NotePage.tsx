import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { isActive, useDeleteNote, useNote, useRegenerateNote, useTemplates, useUpdateNote } from '../../api/hooks';
import { ApiError } from '../../api/client';
import type { Note, NoteResult } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Menu } from '../../components/Menu';
import { RecordSheet, SheetEntry } from '../../components/RecordSheet';
import { Callout, EmptyState, ErrorState, LoadingBlock, Skeleton, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber, patientLabel } from '../../lib/format';
import { fullNoteText, isOmitted, missingBehaviors, renderSectionText } from '../../lib/renderNote';
import { DraftAnotherDialog } from './DraftAnotherDialog';
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
            It may have been deleted. Go back to your notes to find another.
          </EmptyState>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Couldn’t load this note" />
        )}
      </div>
    );
  }
  return <NoteView key={note.id} note={note} />;
}

const TIMEOUT_COPY = "Drafting didn't finish. Regenerate to try again.";

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
  const [draftOpen, setDraftOpen] = useState(false);
  const [regenTemplate, setRegenTemplate] = useState(note.template_id);

  const active = isActive(note.status);
  const behaviors = useMemo(() => missingBehaviors(note.template_snapshot), [note.template_snapshot]);

  // Fade the sheet in only when this view watched the draft finish.
  const [sawActive, setSawActive] = useState(active);
  if (active && !sawActive) setSawActive(true);

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
      onError: (e) => toast.show(errorMessage(e, 'Couldn’t save your changes. Try again.'), 'error'),
    });
  }
  function openRegenerate() {
    setRegenTemplate(note.template_id);
    setRegenOpen(true);
  }
  function doRegenerate() {
    regenerate.mutate(regenTemplate !== note.template_id ? regenTemplate : undefined, {
      onSuccess: () => {
        setRegenOpen(false);
        setEditing(false);
        setDraft(null);
      },
      onError: (e) => {
        setRegenOpen(false);
        toast.show(errorMessage(e, 'Couldn’t regenerate this note. Try again.'), 'error');
      },
    });
  }
  function doDelete() {
    del.mutate(note.id, {
      onSuccess: () => {
        toast.show('Note deleted');
        void navigate('/notes', { replace: true });
      },
      onError: (e) => {
        setConfirmDelete(false);
        toast.show(errorMessage(e, 'Couldn’t delete this note. Try again.'), 'error');
      },
    });
  }
  async function copy(text: string, what: string) {
    const ok = await copyToClipboard(text);
    toast.show(ok ? `${what} copied` : 'Couldn’t copy. Select the text and copy it manually.', ok ? 'info' : 'error');
  }

  const result = editing && draft ? draft : note.result;
  const completed = note.status === 'completed' && !!result;
  const failed = note.status === 'failed';
  const hiddenCount = result && !editing ? result.sections.filter((s) => isOmitted(s, behaviors)).length : 0;
  const details = [note.patient.species, note.patient.breed, note.patient.age, note.patient.sex, note.patient.weight].filter(Boolean).join(' · ');
  const metaLine = [note.template_name, `Drafted ${formatDateTime(note.created_at)}`, note.clinician].filter(Boolean).join(' · ');

  return (
    <div className="page page-note">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/notes">Notes</Link> <span aria-hidden="true">/</span> <span aria-current="page">{patientLabel(note.patient)}</span>
      </nav>

      <header className="note-head">
        <div className="note-head-main">
          <h1>{patientLabel(note.patient)}</h1>
          <p className="muted">{details || 'No patient details'}</p>
          <p className="note-meta">
            <span>{metaLine}</span>
            <StatusBadge status={note.status} />
            {note.edited && <span className="badge">Edited</span>}
          </p>
        </div>
        <div className="page-actions">
          {editing ? (
            <>
              <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="btn" onClick={cancelEdit} disabled={update.isPending}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {completed && (
                <button type="button" className="btn btn-primary" onClick={() => void copy(fullNoteText(note), 'Note')}>
                  <Icon name="copy" size={16} /> Copy note
                </button>
              )}
              {(completed || active) && (
                <button type="button" className="btn" onClick={startEdit} disabled={active}>
                  <Icon name="edit" size={16} /> Edit
                </button>
              )}
              {active && (
                <button type="button" className="btn" disabled>
                  <Icon name="refresh" size={16} /> Regenerate
                </button>
              )}
              <Menu label="More" align="right" buttonClassName="btn">
                {(close) => (
                  <>
                    <button
                      type="button"
                      disabled={active}
                      onClick={() => {
                        close();
                        setDraftOpen(true);
                      }}
                    >
                      Draft another note
                    </button>
                    {!active && (
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          openRegenerate();
                        }}
                      >
                        Regenerate
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        close();
                        setConfirmDelete(true);
                      }}
                    >
                      Delete note
                    </button>
                  </>
                )}
              </Menu>
            </>
          )}
        </div>
      </header>

      {failed && (
        <Callout
          kind="danger"
          role="alert"
          title={note.error?.code === 'GENERATION_TIMEOUT' ? TIMEOUT_COPY : 'Drafting failed'}
          actions={
            <button type="button" className="btn btn-sm" onClick={openRegenerate}>
              <Icon name="refresh" size={14} /> Regenerate
            </button>
          }
        >
          {note.error?.code !== 'GENERATION_TIMEOUT' && (
            <p>
              {note.error?.message ?? 'The note could not be drafted.'} Regenerate to try again.
              {note.error?.code && <span className="faint"> ({note.error.code})</span>}
            </p>
          )}
        </Callout>
      )}

      {active && <Progress note={note} />}

      {completed && result && (
        <div className={`note-layout${sawActive ? ' fade-in' : ''}`}>
          <Rail result={result} editing={editing} onActionItems={(action_items) => setDraft({ ...result, action_items })} />
          <div className="note-main">
            <RecordSheet label={`Note for ${patientLabel(note.patient)}`}>
              <SheetEntry title="Summary" lead>
                {editing ? (
                  <div className="field">
                    <label htmlFor="summary-edit" className="sr-only">
                      Summary
                    </label>
                    <textarea id="summary-edit" rows={3} value={result.visit_summary} onChange={(e) => setDraft({ ...result, visit_summary: e.target.value })} />
                  </div>
                ) : (
                  <p>{result.visit_summary}</p>
                )}
              </SheetEntry>
              {result.sections.map((s, idx) => {
                const omitted = isOmitted(s, behaviors);
                if (omitted && !showEmpty && !editing) return null;
                return (
                  <SheetEntry
                    key={s.section_id}
                    id={`entry-${s.section_id}`}
                    title={s.title}
                    flag={s.used_defaults ? 'Normal defaults: confirm' : undefined}
                    muted={omitted || s.not_discussed}
                    onCopy={!editing && !s.not_discussed ? () => void copy(renderSectionText(s, behaviors), s.title) : undefined}
                  >
                    {editing ? (
                      <SectionEditor section={s} onChange={(next) => setDraft({ ...result, sections: result.sections.map((x, i) => (i === idx ? next : x)) })} />
                    ) : (
                      <SectionBody section={s} behavior={behaviors[s.section_id]} />
                    )}
                  </SheetEntry>
                );
              })}
            </RecordSheet>

            {hiddenCount > 0 && (
              <button type="button" className="btn btn-ghost toggle-empty" onClick={() => setShowEmpty((v) => !v)} aria-pressed={showEmpty}>
                {showEmpty ? 'Hide empty sections' : `Show empty sections (${hiddenCount})`}
              </button>
            )}
            <TranscriptBox transcript={note.transcript} />
            <ModelLine note={note} />
          </div>
        </div>
      )}

      {!completed && !active && <TranscriptBox transcript={note.transcript} />}

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

      <DraftAnotherDialog note={note} open={draftOpen} onClose={() => setDraftOpen(false)} />

      <ConfirmDialog open={regenOpen} title="Regenerate note" confirmLabel="Regenerate" busy={regenerate.isPending} onConfirm={doRegenerate} onCancel={() => setRegenOpen(false)}>
        <p className="muted">
          This drafts a new note from the original transcript.{note.edited ? ' Your edits will be discarded.' : ''}
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

function TranscriptBox({ transcript }: { transcript: string }) {
  return (
    <details className="collapse transcript-box">
      <summary>Original transcript</summary>
      <pre className="transcript-pre">{transcript}</pre>
    </details>
  );
}

function ModelLine({ note }: { note: Note }) {
  const m = note.model_info;
  if (!m) return null;
  return (
    <p className="model-info">
      {m.provider} · {m.model_id} · {formatNumber(m.input_tokens)} in / {formatNumber(m.output_tokens)} out tokens · {(m.latency_ms / 1000).toFixed(1)} s
    </p>
  );
}

/** Sticky right rail: what to check before filing, and follow-ups. */
function Rail({ result, editing, onActionItems }: { result: NoteResult; editing: boolean; onActionItems: (items: string[]) => void }) {
  const defaults = result.sections.filter((s) => s.used_defaults && !s.not_discussed);
  const count = result.review_flags.length + defaults.length;
  return (
    <aside className="note-rail" aria-label="Review">
      <section className="rail-block" aria-labelledby="rail-check">
        <h2 id="rail-check">
          Check before filing <span className="count">({count})</span>
        </h2>
        {count > 0 ? (
          <ul className="flag-list">
            {result.review_flags.map((f, i) => (
              <li key={`f${i}`}>{f}</li>
            ))}
            {defaults.map((s) => (
              <li key={s.section_id}>
                <a href={`#entry-${s.section_id}`}>{s.title}</a> uses normal defaults. Confirm them.
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing flagged.</p>
        )}
      </section>
      <section className="rail-block" aria-labelledby="rail-follow">
        <h2 id="rail-follow">Follow-ups</h2>
        {editing ? (
          <ActionItemsEditor items={result.action_items} onChange={onActionItems} />
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
          <p className="muted">No follow-ups.</p>
        )}
      </section>
    </aside>
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
    <div className="note-layout">
      <div className="note-main">
        <div className="progress-line">
          <div role="status" aria-busy="true">
            <strong>{note.status === 'pending' ? 'Queued…' : 'Drafting your note…'}</strong>
          </div>
          <p className="muted small">Elapsed: {secs}s. This usually takes 10–60 seconds. You can leave this page; the note will be in your list.</p>
        </div>
        <RecordSheet label="Note placeholder">
          {[{ id: 'summary', title: 'Summary' }, ...sections].map((s) => (
            <section className="entry is-skeleton" key={s.id} aria-hidden="true">
              <div className="entry-margin">
                <div className="entry-title muted">{s.title}</div>
              </div>
              <div className="entry-body">
                <Skeleton />
                <Skeleton width="88%" />
                <Skeleton width="56%" />
              </div>
            </section>
          ))}
        </RecordSheet>
      </div>
    </div>
  );
}

function ActionItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="list-editor">
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <label htmlFor={`action-${i}`} className="sr-only">
              Follow-up {i + 1}
            </label>
            <input id={`action-${i}`} type="text" value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Remove follow-up ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm" onClick={() => onChange([...items, ''])}>
        <Icon name="plus" size={14} /> Add follow-up
      </button>
    </div>
  );
}
