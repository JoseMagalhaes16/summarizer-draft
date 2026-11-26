import { useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAiEnabled, useCreateManualNote, useCreateNote, useTemplates } from '../../api/hooks';
import { useToast } from '../../components/Toast';
import type { Patient } from '../../api/types';
import { Menu } from '../../components/Menu';
import { ErrorState, LoadingBlock, PageHead, Callout } from '../../components/ui';
import { isPayloadTooLarge } from '../../lib/errors';
import { TRANSCRIPT_LIMIT_HELP, transcriptUsage } from '../../lib/transcriptLimits';
import { Link } from 'react-router';
import { SAMPLE_TRANSCRIPTS } from '../../samples/transcripts';
import { validateManualNote, validateNewNote } from './newNoteValidation';
import { ChoiceCards } from './ChoiceCards';
import { parseMode, readStoredMode, storeMode, templateHasDefaults, type NoteMode } from './noteMode';
import { TemplatePicker } from './TemplatePicker';
import { ApiError } from '../../api/client';

const PATIENT_FIELDS: { key: keyof Patient; label: string; placeholder: string }[] = [
  { key: 'name', label: 'Patient name', placeholder: 'e.g. Biscuit' },
  { key: 'species', label: 'Species', placeholder: 'e.g. canine' },
  { key: 'breed', label: 'Breed', placeholder: 'e.g. Labrador Retriever' },
  { key: 'age', label: 'Age', placeholder: 'e.g. 6 years' },
  { key: 'sex', label: 'Sex', placeholder: 'e.g. Male, neutered' },
  { key: 'weight', label: 'Weight', placeholder: 'e.g. 34 kg' },
];

export function NewNotePage() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const create = useCreateNote();
  const createManual = useCreateManualNote();
  const toast = useToast();
  const aiEnabled = useAiEnabled();
  const [params] = useSearchParams();
  const uid = useId();

  // Deep link (?mode=manual) beats the remembered choice, which beats the default.
  const [chosenMode, setChosenMode] = useState<NoteMode>(() => parseMode(params.get('mode')) ?? readStoredMode() ?? 'ai');
  // With AI switched off there is only one way to write a note.
  const mode: NoteMode = aiEnabled ? chosenMode : 'manual';
  const manual = mode === 'manual';
  const [startWith, setStartWith] = useState<'blank' | 'defaults'>('blank');

  const [chosenTemplateId, setTemplateId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [patient, setPatient] = useState<Patient>({});
  const [clinician, setClinician] = useState('');
  const [patientOpen, setPatientOpen] = useState(false);
  const [suggestedId, setSuggestedId] = useState<string | null>(null);

  // Until the user picks one, the first template is preselected.
  const templateId = chosenTemplateId ?? templates.data?.[0]?.id ?? null;

  const { valid, errors } = useMemo(
    () => (manual ? validateManualNote(templateId, transcript) : validateNewNote(templateId, transcript)),
    [manual, templateId, transcript],
  );
  const chosenTemplate = templates.data?.find((t) => t.id === templateId);
  const hasDefaults = templateHasDefaults(chosenTemplate);
  const prefill = startWith === 'defaults' && hasDefaults;
  const active = manual ? createManual : create;

  function chooseMode(m: NoteMode) {
    setChosenMode(m);
    storeMode(m);
  }
  const usage = useMemo(() => transcriptUsage(transcript), [transcript]);
  const suggested = suggestedId && suggestedId !== templateId ? templates.data?.find((t) => t.id === suggestedId) : undefined;
  const tooLarge = isPayloadTooLarge(active.error);

  function loadSample(id: string) {
    const s = SAMPLE_TRANSCRIPTS.find((x) => x.id === id);
    if (!s) return;
    setTranscript(s.text);
    setPatient(s.patient);
    setPatientOpen(true);
    // Suggest, don't switch: the template stays whatever the user picked.
    setSuggestedId(templates.data?.find((t) => t.appointment_type === s.appointment_type)?.id ?? null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !templateId || active.isPending) return;
    const cleaned: Patient = {};
    for (const [k, v] of Object.entries(patient)) if (v && v.trim()) cleaned[k as keyof Patient] = v.trim();
    if (manual) {
      createManual.mutate(
        {
          template_id: templateId,
          patient: cleaned,
          ...(clinician.trim() ? { clinician: clinician.trim() } : {}),
          ...(transcript.trim() ? { transcript } : {}),
          ...(prefill ? { prefill_defaults: true } : {}),
        },
        {
          onSuccess: (n) => {
            toast.show('Note created');
            void navigate(`/notes/${n.id}?edit=1`);
          },
        },
      );
      return;
    }
    create.mutate(
      { template_id: templateId, transcript, patient: cleaned, ...(clinician.trim() ? { clinician: clinician.trim() } : {}) },
      { onSuccess: (n) => void navigate(`/notes/${n.id}`) },
    );
  }

  return (
    <div className="page">
      <PageHead
        title="New note"
        subtitle={
          manual
            ? 'Choose a template and write the note yourself. No AI is involved.'
            : 'Choose a template, paste the consult transcript, and VetScribe drafts the clinical note.'
        }
      />

      <form className="stack" onSubmit={onSubmit} noValidate aria-label="New note">
        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-mode`}>
          <h2 id={`${uid}-mode`} className="step-title">
            How do you want to write this note?
          </h2>
          <ChoiceCards<NoteMode>
            label="How to write this note"
            value={mode}
            onChange={chooseMode}
            choices={[
              {
                value: 'ai',
                title: 'Draft from a transcript',
                desc: aiEnabled ? 'Paste the consult and VetScribe drafts the note for you to check.' : 'AI drafting is switched off in this environment.',
                disabled: !aiEnabled,
              },
              { value: 'manual', title: 'Write it myself', desc: 'Fill in the template yourself. Nothing is sent to an AI.' },
            ]}
          />
        </section>

        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-tpl`}>
          <h2 id={`${uid}-tpl`} className="step-title">
            <span className="step-num" aria-hidden="true">1</span> Template
          </h2>
          {templates.isLoading && <LoadingBlock label="Loading templates…" />}
          {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} title="Couldn’t load templates" />}
          {templates.data && templates.data.length === 0 && (
            <Callout kind="warn">
              No templates yet. <Link to="/templates/new">Create a template</Link> to start drafting.
            </Callout>
          )}
          {templates.data && templates.data.length > 0 && <TemplatePicker templates={templates.data} value={templateId} onChange={setTemplateId} />}
        </section>

        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-pat`}>
          <details className="collapse" open={patientOpen} onToggle={(e) => setPatientOpen(e.currentTarget.open)}>
            <summary id={`${uid}-pat`} className="step-title">
              <span className="step-num" aria-hidden="true">2</span> Patient details <span className="optional">(optional)</span>
            </summary>
            <div className="grid-3" style={{ marginTop: 'var(--s-3)' }}>
              {PATIENT_FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`${uid}-${f.key}`}>{f.label}</label>
                  <input
                    id={`${uid}-${f.key}`}
                    type="text"
                    placeholder={f.placeholder}
                    value={patient[f.key] ?? ''}
                    onChange={(e) => setPatient((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor={`${uid}-clin`}>Clinician</label>
                <input id={`${uid}-clin`} type="text" placeholder="e.g. Dr. Patel" value={clinician} onChange={(e) => setClinician(e.target.value)} />
              </div>
            </div>
          </details>
        </section>

        {manual ? (
          <>
        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-start`}>
          <h2 id={`${uid}-start`} className="step-title">
            <span className="step-num" aria-hidden="true">3</span> Start with
          </h2>
          <ChoiceCards<'blank' | 'defaults'>
            label="Start with"
            value={prefill ? 'defaults' : 'blank'}
            onChange={setStartWith}
            choices={[
              { value: 'blank', title: 'Blank sections', desc: 'Every section is empty. You fill in what you need.' },
              {
                value: 'defaults',
                title: 'The template’s normal findings',
                desc: hasDefaults
                  ? 'Sections with normal findings are filled in and marked “Normal defaults: confirm”, so you check them before filing.'
                  : 'This template has no normal findings to fill in.',
                disabled: !hasDefaults,
              },
            ]}
          />
          <details className="collapse" style={{ marginTop: 'var(--s-2)' }}>
            <summary>
              Reference transcript <span className="optional">(optional)</span>
            </summary>
            <div className="field" style={{ marginTop: 'var(--s-3)' }}>
              <p className="hint" id={`${uid}-ref-hint`}>
                Paste a transcript or notes to keep beside the note. It is saved with the note and never sent to an AI.
              </p>
              <label htmlFor={`${uid}-ref`} className="sr-only">
                Reference transcript
              </label>
              <textarea
                id={`${uid}-ref`}
                className="transcript"
                rows={8}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                aria-invalid={usage.over || tooLarge}
                aria-describedby={`${uid}-ref-hint ${uid}-count`}
              />
              <div id={`${uid}-count`} aria-live="polite">
                {usage.over && errors.transcript ? <span className="error">{errors.transcript}</span> : usage.near && <span className="counter">{usage.label}</span>}
              </div>
            </div>
          </details>
          {tooLarge && (
            <Callout kind="danger" role="alert" title="This transcript is too large to send">
              <p>{TRANSCRIPT_LIMIT_HELP}</p>
            </Callout>
          )}
        </section>

          </>
        ) : (
        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-tx`}>
          <div className="row-between">
            <h2 id={`${uid}-tx`} className="step-title">
              <span className="step-num" aria-hidden="true">3</span> Transcript
            </h2>
            <Menu label="Load sample" align="right">
              {(close) =>
                SAMPLE_TRANSCRIPTS.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => {
                      loadSample(s.id);
                      close();
                    }}
                  >
                    <div className="menu-title">{s.label}</div>
                    <div className="menu-sub">{s.description}</div>
                  </button>
                ))
              }
            </Menu>
          </div>
          {suggested && (
            <p className="suggest" role="status">
              <span>
                This sample fits the <strong>{suggested.name}</strong> template.
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setTemplateId(suggested.id);
                  setSuggestedId(null);
                }}
              >
                Use {suggested.name}
              </button>
            </p>
          )}
          <div className="field">
            <label htmlFor={`${uid}-text`} className="sr-only">
              Transcript
            </label>
            <textarea
              id={`${uid}-text`}
              className="transcript"
              rows={14}
              placeholder="Paste the consultation transcript here…"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              aria-invalid={usage.over || tooLarge}
              aria-describedby={`${uid}-count`}
            />
            <div id={`${uid}-count`} aria-live="polite">
              {usage.over && errors.transcript ? (
                <span className="error">{errors.transcript}</span>
              ) : (
                usage.near && <span className="counter">{usage.label}</span>
              )}
            </div>
          </div>
          {tooLarge && (
            <Callout kind="danger" role="alert" title="This transcript is too large to send">
              <p>{TRANSCRIPT_LIMIT_HELP}</p>
            </Callout>
          )}
        </section>
        )}

        {active.isError && !tooLarge && (
          <ErrorState
            error={active.error}
            title={
              active.error instanceof ApiError && active.error.code === 'VALIDATION_ERROR'
                ? 'Check your input'
                : manual
                  ? 'Couldn’t create the note'
                  : 'Couldn’t start drafting'
            }
          />
        )}

        <div className="form-foot">
          <p className="muted small">{manual ? 'You write every word. Nothing is drafted for you.' : 'VetScribe writes drafts. Check the flagged items before you file.'}</p>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!valid || active.isPending}>
            {manual ? (active.isPending ? 'Creating…' : 'Create note') : active.isPending ? 'Starting…' : 'Generate note'}
          </button>
        </div>
      </form>
    </div>
  );
}
