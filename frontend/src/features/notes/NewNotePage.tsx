import { useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCreateNote, useTemplates } from '../../api/hooks';
import { MAX_TRANSCRIPT_CHARS, type Patient } from '../../api/types';
import { Menu } from '../../components/Menu';
import { ErrorState, LoadingBlock, PageHead, Callout } from '../../components/ui';
import { Link } from 'react-router';
import { SAMPLE_TRANSCRIPTS } from '../../samples/transcripts';
import { validateNewNote } from './newNoteValidation';
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
  const uid = useId();

  const [chosenTemplateId, setTemplateId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [patient, setPatient] = useState<Patient>({});
  const [clinician, setClinician] = useState('');
  const [patientOpen, setPatientOpen] = useState(false);

  // Until the user picks one, the first template is preselected.
  const templateId = chosenTemplateId ?? templates.data?.[0]?.id ?? null;

  const { valid, errors } = useMemo(() => validateNewNote(templateId, transcript), [templateId, transcript]);
  const over = transcript.length > MAX_TRANSCRIPT_CHARS;

  function loadSample(id: string) {
    const s = SAMPLE_TRANSCRIPTS.find((x) => x.id === id);
    if (!s) return;
    setTranscript(s.text);
    setPatient(s.patient);
    setPatientOpen(true);
    const match = templates.data?.find((t) => t.appointment_type === s.appointment_type);
    if (match) setTemplateId(match.id);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !templateId || create.isPending) return;
    const cleaned: Patient = {};
    for (const [k, v] of Object.entries(patient)) if (v && v.trim()) cleaned[k as keyof Patient] = v.trim();
    create.mutate(
      { template_id: templateId, transcript, patient: cleaned, ...(clinician.trim() ? { clinician: clinician.trim() } : {}) },
      { onSuccess: (n) => void navigate(`/notes/${n.id}`) },
    );
  }

  return (
    <div className="page">
      <PageHead title="New note" subtitle="Pick a template, paste the consult transcript, and VetScribe drafts the clinical note." />

      <form className="stack" onSubmit={onSubmit} noValidate aria-label="New note">
        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-tpl`}>
          <h2 id={`${uid}-tpl`} className="section-title">
            1. Template
          </h2>
          {templates.isLoading && <LoadingBlock label="Loading templates…" />}
          {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} title="Couldn’t load templates" />}
          {templates.data && templates.data.length === 0 && (
            <Callout kind="warn">
              No templates yet. <Link to="/templates/new">Create one</Link> first.
            </Callout>
          )}
          {templates.data && templates.data.length > 0 && <TemplatePicker templates={templates.data} value={templateId} onChange={setTemplateId} />}
        </section>

        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-pat`}>
          <details className="collapse" open={patientOpen} onToggle={(e) => setPatientOpen(e.currentTarget.open)}>
            <summary id={`${uid}-pat`}>
              2. Patient details <span className="faint" style={{ fontWeight: 400 }}>(optional)</span>
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

        <section className="card card-pad stack-sm" aria-labelledby={`${uid}-tx`}>
          <div className="row-between">
            <h2 id={`${uid}-tx`} className="section-title">
              3. Transcript
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
              aria-invalid={over}
              aria-describedby={`${uid}-count`}
            />
            <div className="row-between">
              <span id={`${uid}-count`} className={`counter ${over ? 'over' : ''}`} aria-live="polite">
                {transcript.length.toLocaleString('en-US')} / {MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters
              </span>
              {over && errors.transcript && <span className="error">{errors.transcript}</span>}
            </div>
          </div>
        </section>

        {create.isError && (
          <ErrorState
            error={create.error}
            title={create.error instanceof ApiError && create.error.code === 'VALIDATION_ERROR' ? 'Please check your input' : 'Couldn’t start generation'}
          />
        )}

        <div className="form-foot">
          <p className="muted small">Notes are AI-drafted. Review flagged items before filing to the patient record.</p>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!valid || create.isPending}>
            {create.isPending ? 'Starting…' : 'Generate note'}
          </button>
        </div>
      </form>
    </div>
  );
}
