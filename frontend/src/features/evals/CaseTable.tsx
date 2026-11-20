import { Fragment, useState } from 'react';
import { useEvalCase } from '../../api/evalHooks';
import type { CaseResult, MetricKey } from '../../api/evalTypes';
import { Icon } from '../../components/Icon';
import { RecordSheet, SheetEntry } from '../../components/RecordSheet';
import { SectionBody } from '../notes/SectionView';
import { ResultCell } from './ResultCell';
import { STATUS_LABEL, metricLabel } from './metrics';

export const rowKey = (r: Pick<CaseResult, 'case_id' | 'rep'>) => `${r.case_id}#${r.rep}`;

function hasProblem(r: CaseResult, metrics: MetricKey[]) {
  return r.status !== 'ok' || metrics.some((m) => typeof r.scores[m] === 'number' && (r.scores[m] as number) < 1);
}

export function CaseTable({ rows, metrics, open, onToggle }: { rows: CaseResult[]; metrics: MetricKey[]; open: Set<string>; onToggle: (k: string) => void }) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const shown = onlyProblems ? rows.filter((r) => hasProblem(r, metrics)) : rows;
  const span = metrics.length + 1;
  return (
    <div className="stack-sm">
      <label className="check small">
        <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
        Only show notes with something missed ({rows.filter((r) => hasProblem(r, metrics)).length} of {rows.length})
      </label>
      <div className="card table-wrap" tabIndex={0} role="region" aria-label="Per-case results, scrolls sideways">
        <table className="table case-table">
          <thead>
            <tr>
              <th scope="col">Case and repetition</th>
              {metrics.map((m) => (
                <th scope="col" key={m}>
                  {metricLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = rowKey(r);
              const isOpen = open.has(k);
              return (
                <Fragment key={k}>
                  <tr id={`row-${k.replace('#', '-')}`} className={isOpen ? 'is-open' : undefined}>
                    <th scope="row" className="case-cell">
                      <button type="button" className="case-toggle" aria-expanded={isOpen} aria-controls={`detail-${k.replace('#', '-')}`} onClick={() => onToggle(k)}>
                        <Icon name="chevron" size={16} style={{ transform: isOpen ? undefined : 'rotate(-90deg)' }} />
                        <span>
                          <span className="case-title">{r.case_title ?? r.case_id}</span>
                          <span className="small muted"> · rep {r.rep}</span>
                          {r.status !== 'ok' && (
                            <span className="badge badge-warn status-badge">
                              <Icon name="alert" size={12} /> {STATUS_LABEL[r.status]}
                            </span>
                          )}
                        </span>
                      </button>
                    </th>
                    {metrics.map((m) => (
                      <td key={m}>
                        <ResultCell value={r.scores[m]} />
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="detail-row" id={`detail-${k.replace('#', '-')}`}>
                      <td colSpan={span}>
                        <CaseDetails row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CaseDetails({ row }: { row: CaseResult }) {
  const c = useEvalCase(row.case_id);
  const d = row.details;
  const anyMiss = d.missed_facts.length + d.forbidden_found.length + d.field_mismatches.length + d.not_discussed_errors.length + d.missing_flags.length + d.missing_actions.length;
  const factHint = (id: string) => c.data?.expectations.facts.find((f) => f.id === id)?.any_of.join(' / ');
  const result = row.result;

  return (
    <div className="case-detail">
      {row.status !== 'ok' && (
        <p className="status-note">
          <strong>{STATUS_LABEL[row.status]}.</strong>{' '}
          {row.status === 'error'
            ? `The request failed (${row.failure_class ?? 'unknown'}) after ${row.attempts ?? 1} attempts. This is a service problem, so it is not scored as a model failure.`
            : row.status === 'refused'
              ? 'The model declined to write a note. Counted as a refusal, not as wrong answers.'
              : row.status === 'truncated'
                ? 'The note was cut off before it finished. Shown here but left out of the averages.'
                : 'The model returned something the app could not read, so only “Valid structure” is scored.'}
        </p>
      )}

      {row.status === 'ok' && (
        <section className="detail-block" aria-label="What was missed">
          <h4>What went wrong</h4>
          {anyMiss === 0 ? (
            <p className="muted">Nothing missed in this note.</p>
          ) : (
            <div className="miss-grid">
              {d.forbidden_found.length > 0 && (
                <div>
                  <h5>Invented or forbidden details found</h5>
                  <ul>
                    {d.forbidden_found.map((f) => (
                      <li key={f.id}>
                        <strong>“{f.term}”</strong>
                        {f.section_id && <span className="muted"> in {f.section_id.replace(/_/g, ' ')}</span>}
                        <blockquote className="snippet">{f.snippet}</blockquote>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.field_mismatches.length > 0 && (
                <div>
                  <h5>Values that don’t match</h5>
                  <table className="mini-table">
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Expected</th>
                        <th scope="col">Got</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.field_mismatches.map((m) => (
                        <tr key={`${m.section_id}.${m.key}`}>
                          <td>{m.key.replace(/_/g, ' ')}</td>
                          <td>{m.expected || <span className="muted">(empty)</span>}</td>
                          <td>{m.got || <span className="muted">(empty)</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.missed_facts.length > 0 && (
                <div>
                  <h5>Key facts missing</h5>
                  <ul>
                    {d.missed_facts.map((id) => (
                      <li key={id}>
                        {id.replace(/-/g, ' ')}
                        {factHint(id) && <span className="muted"> (looked for: {factHint(id)})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.not_discussed_errors.length > 0 && (
                <div>
                  <h5>Sections handled wrongly</h5>
                  <ul>
                    {d.not_discussed_errors.map((id) => (
                      <li key={id}>{id.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              {d.missing_flags.length > 0 && (
                <div>
                  <h5>Uncertainty not flagged</h5>
                  <ul>
                    {d.missing_flags.map((id) => (
                      <li key={id}>{id.replace(/-/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              {d.missing_actions.length > 0 && (
                <div>
                  <h5>Follow-ups missing</h5>
                  <ul>
                    {d.missing_actions.map((id) => (
                      <li key={id}>{id.replace(/-/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="detail-block" aria-label="Generated note">
          <h4>Note as drafted</h4>
          <RecordSheet label={`Note for ${row.case_title ?? row.case_id}, repetition ${row.rep}`}>
            <SheetEntry title="Summary" lead>
              {result.visit_summary ? <p>{result.visit_summary}</p> : <p className="not-discussed">Empty.</p>}
            </SheetEntry>
            {result.sections.map((s) => (
              <SheetEntry key={s.section_id} title={s.title} flag={s.used_defaults ? 'Normal defaults: confirm' : undefined} muted={s.not_discussed}>
                <SectionBody section={s} />
              </SheetEntry>
            ))}
            {result.review_flags.length > 0 && (
              <SheetEntry title="Check before filing">
                <ul className="bullets">
                  {result.review_flags.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </SheetEntry>
            )}
            {result.action_items.length > 0 && (
              <SheetEntry title="Follow-ups">
                <ul className="bullets">
                  {result.action_items.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </SheetEntry>
            )}
          </RecordSheet>
        </section>
      )}

      <details className="collapse detail-block">
        <summary>Transcript</summary>
        {c.isLoading && <p className="muted small">Loading transcript…</p>}
        {c.isError && <p className="error small">Couldn’t load the transcript.</p>}
        {c.data && <pre className="transcript-pre">{c.data.transcript}</pre>}
      </details>
    </div>
  );
}
