import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useCreateEvalRun, useEvalCases } from '../../api/evalHooks';
import { useHealth } from '../../api/hooks';
import type { EvalProvider } from '../../api/evalTypes';
import { Callout, PageHead } from '../../components/ui';
import { PROVIDER_LABEL } from './metrics';
import { cliCommand, toRunConfig, validateRunForm, type RunFormState } from './newRunValidation';

const PROVIDER_HELP: Record<EvalProvider, string> = {
  mock: 'The offline demo generator. Quick, free, and gives mid-range scores.',
  oracle: 'Writes a perfect note from the answer key. Should score 100%, which confirms the graders work.',
  null: 'Writes an empty note. Should score about 0% on recall, which confirms the graders work.',
  bedrock: 'The real model on Amazon Bedrock. Needs the server to be set up for Bedrock.',
};
const PROVIDERS: EvalProvider[] = ['mock', 'oracle', 'null', 'bedrock'];

export function NewRunPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const cases = useEvalCases();
  const health = useHealth();
  const create = useCreateEvalRun();
  const preset = params.get('provider');
  const [f, setF] = useState<RunFormState>({
    label: '',
    provider: PROVIDERS.includes(preset as EvalProvider) ? (preset as EvalProvider) : 'mock',
    model_id: '',
    structured_mode: 'output_config',
    effort: 'medium',
    reps: '2',
    tags: [],
    judge: false,
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateRunForm>>({});
  const set = <K extends keyof RunFormState>(k: K, v: RunFormState[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const allTags = useMemo(() => [...new Set((cases.data ?? []).flatMap((c) => c.tags))].sort(), [cases.data]);
  const matching = (cases.data ?? []).filter((c) => !f.tags.length || c.tags.some((t) => f.tags.includes(t))).length;
  const bedrock = f.provider === 'bedrock';
  const err = create.error instanceof ApiError ? create.error : null;
  const disabledByServer = health.data?.evals_allow_trigger === false;
  const blocked = err?.status === 403 || disabledByServer;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateRunForm(f);
    setErrors(v);
    if (Object.keys(v).length) return;
    create.mutate(toRunConfig(f), { onSuccess: (r) => nav(`/evals/runs/${r.run_id}`) });
  };

  const cli = cliCommand(toRunConfig({ ...f, label: f.label.trim() || 'my run' }));

  return (
    <>
      <div className="crumbs">
        <Link to="/evals">Runs</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">New run</span>
      </div>
      <PageHead title="New run" subtitle="Draft every selected case with one setup, then score the notes against the answer key." />

      {blocked && (
        <Callout kind="warn" role="alert" title="Starting runs from the app is turned off on this server">
          <p>
            {err?.status === 403 ? err.message : 'This server only reads results.'} Full runs are started from the command line or CI, and the results then show up here.
          </p>
          <p className="small" style={{ marginTop: 8 }}>
            Run this from the backend folder:
          </p>
          <pre className="cli">{cli}</pre>
        </Callout>
      )}
      {err && err.status !== 403 && (
        <Callout kind="danger" role="alert" title="Couldn’t start the run">
          <p>{err.message}</p>
        </Callout>
      )}

      <form className="card card-pad stack run-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="run-label">
            Run name <span className="req" aria-hidden="true">*</span>
          </label>
          <input id="run-label" type="text" value={f.label} maxLength={120} onChange={(e) => set('label', e.target.value)} aria-invalid={!!errors.label} aria-describedby="run-label-msg" placeholder="e.g. Prompt v3, effort high" />
          <span id="run-label-msg" className={errors.label ? 'error' : 'hint'} role={errors.label ? 'alert' : undefined}>
            {errors.label ?? 'Shown in the runs list and on comparisons.'}
          </span>
        </div>

        <fieldset className="field">
          <legend className="label">Generator</legend>
          <div className="provider-list">
            {PROVIDERS.map((p) => (
              <label key={p} className={`picker-row${f.provider === p ? ' selected' : ''}`}>
                <input type="radio" name="provider" value={p} checked={f.provider === p} onChange={() => set('provider', p)} />
                <span className="picker-title">{PROVIDER_LABEL[p]}</span>
                <span className="small muted">{PROVIDER_HELP[p]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {bedrock && (
          <div className="grid-3">
            <div className="field">
              <label htmlFor="run-model">
                Model id <span className="req" aria-hidden="true">*</span>
              </label>
              <input id="run-model" type="text" value={f.model_id} onChange={(e) => set('model_id', e.target.value)} aria-invalid={!!errors.model_id} aria-describedby="run-model-msg" placeholder="us.anthropic.claude-…" />
              <span id="run-model-msg" className={errors.model_id ? 'error' : 'hint'} role={errors.model_id ? 'alert' : undefined}>
                {errors.model_id ?? 'The exact Bedrock model or inference profile id.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="run-mode">Structured output</label>
              <select id="run-mode" value={f.structured_mode} onChange={(e) => set('structured_mode', e.target.value as RunFormState['structured_mode'])}>
                <option value="output_config">Native JSON schema</option>
                <option value="tool">Single tool call</option>
              </select>
              <span className="hint">How the model is asked to return the note.</span>
            </div>
            <div className="field">
              <label htmlFor="run-effort">Effort</label>
              <select id="run-effort" value={f.effort} onChange={(e) => set('effort', e.target.value as RunFormState['effort'])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <span className="hint">More effort is slower and costs more.</span>
            </div>
          </div>
        )}

        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="run-reps">Repetitions</label>
          <input id="run-reps" type="number" inputMode="numeric" min={1} max={5} value={f.reps} onChange={(e) => set('reps', e.target.value)} aria-invalid={!!errors.reps} aria-describedby="run-reps-msg" />
          <span id="run-reps-msg" className={errors.reps ? 'error' : 'hint'} role={errors.reps ? 'alert' : undefined}>
            {errors.reps ?? 'Each case is drafted this many times (1 to 5). More repetitions narrow the uncertainty.'}
          </span>
        </div>

        <fieldset className="field">
          <legend className="label">Cases</legend>
          <div className="chips" role="group" aria-label="Filter cases by tag">
            {allTags.map((t) => (
              <label key={t} className="chip">
                <input type="checkbox" checked={f.tags.includes(t)} onChange={() => set('tags', f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t])} />
                {t}
              </label>
            ))}
          </div>
          <span className="hint">
            {f.tags.length ? `${matching} of ${cases.data?.length ?? 0} cases carry at least one chosen tag.` : `No tag chosen, so all ${cases.data?.length ?? 0} cases run.`}
          </span>
        </fieldset>

        <div className="field">
          <label className="check">
            <input type="checkbox" checked={bedrock && f.judge} disabled={!bedrock} onChange={(e) => set('judge', e.target.checked)} />
            Also ask a second model to judge the notes
          </label>
          <span className="hint">{bedrock ? 'Adds faithfulness, completeness and style ratings. Costs extra.' : 'Only available for Bedrock runs.'}</span>
        </div>

        <div className="row form-actions">
          <button type="submit" className="btn btn-primary" disabled={create.isPending || disabledByServer}>
            {create.isPending ? 'Starting…' : 'Start run'}
          </button>
          <Link to="/evals" className="btn btn-ghost">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
