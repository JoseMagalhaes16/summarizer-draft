import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useEvalResults, useEvalRun } from '../../api/evalHooks';
import { METRIC_KEYS, type MetricKey, type RunSummary } from '../../api/evalTypes';
import { Callout, ErrorState, LoadingBlock, PageHead } from '../../components/ui';
import { formatDateTime, formatNumber } from '../../lib/format';
import { CaseTable, rowKey } from './CaseTable';
import { MetricTile } from './MetricMeter';
import { RunProgress, RunStatusBadge } from './RunBits';
import { PROVIDER_LABEL, METRIC_INFO, metricLabel, pct, ciPts, runTitle } from './metrics';

export function RunDetailPage() {
  const { id } = useParams();
  const run = useEvalRun(id);
  const running = run.data?.status === 'running';
  const results = useEvalResults(id, !!running);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  if (run.isLoading) return <LoadingBlock label="Loading run…" />;
  if (run.isError || !run.data) return <ErrorState error={run.error} onRetry={() => void run.refetch()} title="Couldn’t load this run" />;
  const r = run.data;
  const c = r.config;
  const metrics = METRIC_KEYS.filter((m) => r.metrics[m]);
  const rows = results.data ?? [];
  const failing = rows.filter((x) => x.scores.hallucination_free === 0);
  const jump = (k: string) => {
    setOpen((cur) => new Set(cur).add(k));
    window.setTimeout(() => document.getElementById(`row-${k.replace('#', '-')}`)?.scrollIntoView?.({ block: 'center' }), 0);
  };

  return (
    <>
      <div className="crumbs">
        <Link to="/evals">Runs</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{c.label}</span>
      </div>
      <PageHead
        title={c.label}
        subtitle={
          <>
            {runTitle(c)}
            {c.provider === 'bedrock' && c.effort ? ` · effort ${c.effort}` : ''}
            {' · '}
            {r.case_count} cases × {c.reps} · started {formatDateTime(r.created_at)}
          </>
        }
        actions={<RunStatusBadge status={r.status} />}
      />

      {(c.provider === 'oracle' || c.provider === 'null') && (
        <Callout kind="info" title={`${PROVIDER_LABEL[c.provider]}: a check on the graders, not on a model`}>
          <p>{c.provider === 'oracle' ? 'This run should score 100% everywhere. Anything lower points to a grader fault.' : 'This run should score near 0% on recall and should not pass “Missing data handled”. Anything higher points to a grader fault.'}</p>
        </Callout>
      )}

      {running && (
        <div className="card card-pad" role="status" aria-live="polite">
          <p>
            <strong>Drafting and scoring notes…</strong> Results appear when the run finishes.
          </p>
          <RunProgress run={r} />
        </div>
      )}
      {r.status === 'failed' && <Callout kind="danger" role="alert" title="This run failed before it finished" />}

      {r.status !== 'running' && (
        <>
          <section className="stack-sm" aria-labelledby="quality-h">
            <h2 className="section-title" id="quality-h">
              Quality scores
            </h2>
            <p className="small muted note-line">
              Each measure stands alone. There is no combined overall score, because a single blended number would hide a drop in one area behind a gain in another. The bar shows the average; the dark band is the 95% interval.
            </p>
            <div className="tile-grid">
              {metrics.map((m) => (
                <MetricTile key={m} metric={m} stat={r.metrics[m]!} />
              ))}
            </div>
          </section>

          {r.metrics.hallucination_free && (
            <section className="stack-sm" aria-labelledby="halluc-h">
              <h2 className="section-title" id="halluc-h">
                {METRIC_INFO.hallucination_free.label}: worst cases
              </h2>
              {failing.length === 0 ? (
                <p className="muted">No invented details were found in any scored note.</p>
              ) : (
                <>
                  <p className="small muted">One invented detail fails the whole note, so these are the notes to read first.</p>
                  <ul className="fail-list">
                    {failing.map((x) => (
                      <li key={rowKey(x)}>
                        <button type="button" className="link-btn" onClick={() => jump(rowKey(x))}>
                          {x.case_title ?? x.case_id} · rep {x.rep}
                        </button>
                        <span className="muted"> found {x.details.forbidden_found.map((f) => `“${f.term}”`).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <RunHealth run={r} />
          <CostSpeed run={r} />
          <TagTable run={r} metrics={metrics} />
        </>
      )}

      <section className="stack-sm" aria-labelledby="cases-h">
        <h2 className="section-title" id="cases-h">
          Results by case
        </h2>
        {results.isError && <ErrorState error={results.error} onRetry={() => void results.refetch()} title="Couldn’t load case results" />}
        {results.isLoading && <LoadingBlock label="Loading case results…" />}
        {results.data && rows.length === 0 && <p className="muted">No notes finished yet.</p>}
        {results.data && rows.length > 0 && <CaseTable rows={rows} metrics={metrics.length ? metrics : (METRIC_KEYS.filter((m) => rows.some((x) => typeof x.scores[m] === 'number')) as MetricKey[])} open={open} onToggle={toggle} />}
      </section>
    </>
  );
}

function RunHealth({ run }: { run: RunSummary }) {
  const total = run.progress.total;
  return (
    <section className="stack-sm" aria-labelledby="health-h">
      <h2 className="section-title" id="health-h">
        Errors, refusals and cut-off notes
      </h2>
      <div className="health-strip">
        <dl className="health-stats">
          <div>
            <dt>Service errors</dt>
            <dd>{formatNumber(run.errors_count)}</dd>
          </div>
          <div>
            <dt>Refusals</dt>
            <dd>{pct(run.refusal_rate)}</dd>
          </div>
          <div>
            <dt>Cut off</dt>
            <dd>{formatNumber(run.truncated_count)}</dd>
          </div>
        </dl>
        <p className="small muted">
          Out of {formatNumber(total)} notes. These are not counted as the model getting things wrong, and none of them lower the quality scores above. A service error means the request itself failed (timeouts, throttling). A refusal is tracked on its own rate. A cut-off note is shown but left out of the averages.
        </p>
      </div>
    </section>
  );
}

function CostSpeed({ run }: { run: RunSummary }) {
  const rng = (p: { p50: number; p95: number }, unit = '') => `${formatNumber(p.p50)}${unit} typical · ${formatNumber(p.p95)}${unit} slowest 5%`;
  return (
    <section className="stack-sm" aria-labelledby="cost-h">
      <h2 className="section-title" id="cost-h">
        Cost and speed
      </h2>
      <dl className="cost-grid card card-pad">
        <div>
          <dt>Total cost</dt>
          <dd>{run.total_cost === null ? <span className="muted">Not priced (model not in the price table)</span> : `$${run.total_cost.toFixed(2)}`}</dd>
        </div>
        <div>
          <dt>Input tokens per note</dt>
          <dd>{rng(run.input_tokens)}</dd>
        </div>
        <div>
          <dt>Output tokens per note</dt>
          <dd>{rng(run.output_tokens)}</dd>
        </div>
        <div>
          <dt>Time per note</dt>
          <dd>{run.latency_ms.p95 >= 1000 ? `${(run.latency_ms.p50 / 1000).toFixed(1)} s typical · ${(run.latency_ms.p95 / 1000).toFixed(1)} s slowest 5%` : rng(run.latency_ms, ' ms')}</dd>
        </div>
        {run.noise_floor !== null && (
          <div>
            <dt>Noise floor</dt>
            <dd>± {Math.round(run.noise_floor * 100)} pts on key facts; smaller differences between runs are not meaningful.</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function TagTable({ run, metrics }: { run: RunSummary; metrics: MetricKey[] }) {
  const tags = Object.keys(run.by_tag ?? {});
  if (!tags.length) return null;
  return (
    <section className="stack-sm" aria-labelledby="tags-h">
      <h2 className="section-title" id="tags-h">
        By visit type
      </h2>
      <div className="card table-wrap" tabIndex={0} role="region" aria-label="Scores by visit type, scrolls sideways">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Visit type</th>
              {metrics.map((m) => (
                <th scope="col" key={m}>
                  {metricLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t}>
                <th scope="row">{t}</th>
                {metrics.map((m) => {
                  const s = run.by_tag![t][m];
                  return (
                    <td key={m} className="nowrap">
                      {s ? (
                        <>
                          <strong>{pct(s.mean)}</strong> <span className="muted small">± {ciPts(s)} · n {s.n}</span>
                        </>
                      ) : (
                        <span className="faint">n.a.</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
