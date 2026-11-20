import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useEvalRuns } from '../../api/evalHooks';
import type { MetricKey, RunSummary } from '../../api/evalTypes';
import { EmptyState, ErrorState, LoadingBlock, PageHead } from '../../components/ui';
import { formatDateTime, relativeTime } from '../../lib/format';
import { RunProgress, RunStatusBadge } from './RunBits';
import { METRIC_INFO, ciPts, pct, runTitle } from './metrics';

const LIST_METRICS: MetricKey[] = ['field_accuracy', 'fact_recall', 'hallucination_free', 'missing_data_handling', 'faithfulness_proxy'];

export function RunsPage() {
  const runs = useEvalRuns();
  const nav = useNavigate();
  const [sel, setSel] = useState<string[]>([]);

  const toggle = (id: string) => setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1], id] : [...cur, id]));
  const compare = () => {
    const picked = (runs.data ?? []).filter((r) => sel.includes(r.run_id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (picked.length === 2) nav(`/evals/compare?base=${picked[0].run_id}&candidate=${picked[1].run_id}`);
  };

  return (
    <>
      <PageHead
        title="Evaluations"
        subtitle="Score the note drafter against cases with known answers. Each quality measure is reported on its own."
        actions={
          <>
            <button type="button" className="btn" disabled={sel.length !== 2} onClick={compare}>
              Compare selected{sel.length ? ` (${sel.length}/2)` : ''}
            </button>
            <Link to="/evals/new" className="btn btn-primary">
              New run
            </Link>
          </>
        }
      />
      {runs.isLoading && <LoadingBlock label="Loading runs…" />}
      {runs.isError && <ErrorState error={runs.error} onRetry={() => void runs.refetch()} title="Couldn’t load runs" />}
      {runs.data && runs.data.length === 0 && (
        <EmptyState
          icon="flask"
          title="No runs yet"
          action={
            <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link to="/evals/new?provider=mock" className="btn btn-primary">
                Start a Mock run
              </Link>
              <Link to="/evals/new?provider=oracle" className="btn">
                Start an Oracle run
              </Link>
            </div>
          }
        >
          A Mock run shows how the tab works. An Oracle run should score 100%, which confirms the graders are working.
        </EmptyState>
      )}
      {runs.data && runs.data.length > 0 && (
        <>
          <div className="card table-wrap">
            <table className="table runs-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Select to compare</span>
                  </th>
                  <th scope="col">Run</th>
                  <th scope="col">Model</th>
                  <th scope="col">Notes</th>
                  <th scope="col">Status</th>
                  {LIST_METRICS.map((m) => (
                    <th scope="col" key={m}>
                      {METRIC_INFO[m].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => (
                  <RunRow key={r.run_id} run={r} checked={sel.includes(r.run_id)} onToggle={() => toggle(r.run_id)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Pick two runs and choose Compare selected. The older run is the base. Open a run for every measure; only five are shown here.
          </p>
        </>
      )}
    </>
  );
}

function RunRow({ run, checked, onToggle }: { run: RunSummary; checked: boolean; onToggle: () => void }) {
  const c = run.config;
  const done = run.status !== 'running';
  return (
    <tr>
      <td>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${c.label} to compare`} />
      </td>
      <td>
        <Link className="row-link-plain" to={`/evals/runs/${run.run_id}`}>
          {c.label}
        </Link>
        <div className="small muted">
          <time dateTime={run.created_at} title={formatDateTime(run.created_at)}>
            {relativeTime(run.created_at)}
          </time>
        </div>
      </td>
      <td>
        <div>{runTitle(c)}</div>
        <div className="small muted">
          {c.provider === 'bedrock' && c.effort ? `Effort ${c.effort}` : c.provider === 'bedrock' ? '' : 'Offline'}
          {c.judge ? ' · with judge' : ''}
        </div>
      </td>
      <td className="nowrap">
        {run.case_count} cases × {c.reps}
      </td>
      <td>
        <RunStatusBadge status={run.status} />
        {run.status === 'running' && <RunProgress run={run} />}
      </td>
      {LIST_METRICS.map((m) => {
        const s = run.metrics[m];
        return (
          <td key={m} className="nowrap">
            {done && s ? (
              <>
                <strong>{pct(s.mean)}</strong> <span className="muted small">± {ciPts(s)}</span>
              </>
            ) : (
              <span className="faint">{done ? 'n.a.' : '…'}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
