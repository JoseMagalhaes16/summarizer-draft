import { Link, useSearchParams } from 'react-router';
import { useEvalCompare, useEvalRuns } from '../../api/evalHooks';
import { METRIC_KEYS, type MetricComparison, type Verdict } from '../../api/evalTypes';
import { EmptyState, ErrorState, LoadingBlock, PageHead } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { metricLabel, METRIC_INFO, pct, signedPts } from './metrics';
import { ResultCell } from './ResultCell';

const VERDICT: Record<Verdict, { text: string; cls: string; icon: 'check' | 'x' | 'minus' }> = {
  better: { text: 'Better', cls: 'badge-accent', icon: 'check' },
  worse: { text: 'Worse', cls: 'badge-danger', icon: 'x' },
  within_noise: { text: 'Within noise', cls: '', icon: 'minus' },
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return (
    <span className={`badge verdict ${v.cls}`}>
      <Icon name={v.icon} size={12} /> {v.text}
    </span>
  );
}

/** Interval plot of the delta on a symmetric axis; the zero line is the "no change" reference. */
function DeltaBand({ m, scale }: { m: MetricComparison; scale: number }) {
  const x = (d: number) => `${50 + (Math.max(-scale, Math.min(scale, d)) / scale) * 50}%`;
  return (
    <div className="delta-plot" aria-hidden="true">
      <span className="delta-zero" />
      <span className={`delta-band delta-${m.verdict}`} style={{ left: x(m.ci_low), width: `calc(${x(m.ci_high)} - ${x(m.ci_low)})` }} />
      <span className={`delta-dot delta-${m.verdict}`} style={{ left: x(m.delta) }} />
    </div>
  );
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const base = params.get('base');
  const cand = params.get('candidate');
  const runs = useEvalRuns();
  const cmp = useEvalCompare(base, cand);
  const done = (runs.data ?? []).filter((r) => r.status === 'completed');

  const pick = (key: 'base' | 'candidate', v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(key, v);
    else next.delete(key);
    setParams(next);
  };

  const c = cmp.data;
  const keys = c ? METRIC_KEYS.filter((k) => c.metrics[k]) : [];
  const scale = c ? Math.max(0.2, ...keys.flatMap((k) => [Math.abs(c.metrics[k]!.ci_low), Math.abs(c.metrics[k]!.ci_high)])) : 0.2;

  // Group flipped notes by case and repetition.
  const groups = new Map<string, NonNullable<typeof c>['flipped']>();
  for (const f of c?.flipped ?? []) groups.set(`${f.case_id}#${f.rep}`, [...(groups.get(`${f.case_id}#${f.rep}`) ?? []), f]);

  return (
    <>
      <div className="crumbs">
        <Link to="/evals">Runs</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Compare</span>
      </div>
      <PageHead title="Compare runs" subtitle="Notes are paired by case and repetition, so the difference reflects the change you made, not which cases were picked." />

      <div className="card card-pad grid-2 pick-row">
        <div className="field">
          <label htmlFor="cmp-base">Base (before)</label>
          <select id="cmp-base" value={base ?? ''} onChange={(e) => pick('base', e.target.value)}>
            <option value="">Choose a run</option>
            {done.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.config.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cmp-cand">Candidate (after)</label>
          <select id="cmp-cand" value={cand ?? ''} onChange={(e) => pick('candidate', e.target.value)}>
            <option value="">Choose a run</option>
            {done.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.config.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(!base || !cand) && <EmptyState icon="list" title="Choose two runs">Pick a base and a candidate above to see what changed.</EmptyState>}
      {base && cand && cmp.isLoading && <LoadingBlock label="Comparing…" />}
      {base && cand && cmp.isError && <ErrorState error={cmp.error} onRetry={() => void cmp.refetch()} title="Couldn’t compare these runs" />}

      {c && (
        <>
          <p className="small muted">
            {c.shared_cases} shared cases. A difference counts as better or worse only when its 95% interval stays clear of zero; otherwise it is within noise.
            {c.base.noise_floor !== null && ` Run-to-run noise on key facts is about ± ${Math.round(c.base.noise_floor * 100)} pts.`}
          </p>
          <div className="card table-wrap" tabIndex={0} role="region" aria-label="Metric comparison, scrolls sideways">
            <table className="table compare-table">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">{c.base.config.label}</th>
                  <th scope="col">{c.candidate.config.label}</th>
                  <th scope="col">Change (95% interval)</th>
                  <th scope="col">
                    <span className="sr-only">Range chart</span>
                  </th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const m = c.metrics[k]!;
                  return (
                    <tr key={k}>
                      <th scope="row">
                        {metricLabel(k)}
                        <div className="small muted fw-normal">{METRIC_INFO[k].help}</div>
                      </th>
                      <td className="nowrap">{pct(m.base_mean)}</td>
                      <td className="nowrap">{pct(m.candidate_mean)}</td>
                      <td className="nowrap">
                        <strong>{signedPts(m.delta)}</strong> <span className="muted small">({signedPts(m.ci_low)} to {signedPts(m.ci_high)})</span>
                      </td>
                      <td className="delta-cell">
                        <DeltaBand m={m} scale={scale} />
                      </td>
                      <td>
                        <VerdictChip verdict={m.verdict} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section className="stack-sm" aria-labelledby="changed-h">
            <h2 className="section-title" id="changed-h">
              Cases that changed
            </h2>
            {groups.size === 0 ? (
              <p className="muted">No note flipped between pass and not-pass on any measure.</p>
            ) : (
              <ul className="changed-list card">
                {[...groups.entries()].map(([k, fs]) => (
                  <li key={k}>
                    <div className="changed-title">
                      {fs[0].case_title ?? fs[0].case_id} <span className="muted small">· rep {fs[0].rep}</span>
                    </div>
                    <ul className="changed-metrics">
                      {fs.map((f) => (
                        <li key={f.metric}>
                          <span>{metricLabel(f.metric)}</span>
                          <span className="changed-arrow">
                            <ResultCell value={f.base} />
                            <Icon name="down" size={14} style={{ transform: 'rotate(-90deg)' }} />
                            <ResultCell value={f.candidate} />
                          </span>
                          <VerdictChip verdict={f.direction} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
