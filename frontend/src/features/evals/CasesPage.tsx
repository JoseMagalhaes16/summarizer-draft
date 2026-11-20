import { Link } from 'react-router';
import { useEvalCases } from '../../api/evalHooks';
import { useTemplates } from '../../api/hooks';
import type { ExpectationCounts } from '../../api/evalTypes';
import { EmptyState, ErrorState, LoadingBlock, PageHead } from '../../components/ui';

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? <span className="badge badge-accent">Vet-verified</span> : <span className="badge badge-warn">Not vet-verified</span>;
}

const COUNT_LABELS: [keyof ExpectationCounts, string, string][] = [
  ['fields', 'value', 'values'],
  ['facts', 'key fact', 'key facts'],
  ['forbidden', 'trap', 'traps'],
  ['not_discussed', 'empty section', 'empty sections'],
  ['defaults_expected', 'default section', 'default sections'],
  ['review_flags', 'flag', 'flags'],
  ['action_items', 'follow-up', 'follow-ups'],
];
export function countsText(c: ExpectationCounts): string {
  return COUNT_LABELS.filter(([k]) => c[k] > 0)
    .map(([k, one, many]) => `${c[k]} ${c[k] === 1 ? one : many}`)
    .join(' · ');
}

export function CasesPage() {
  const cases = useEvalCases();
  const templates = useTemplates();
  const tname = (id: string) => templates.data?.find((t) => t.id === id)?.name ?? id;
  return (
    <>
      <PageHead title="Cases" subtitle="Transcripts with an answer key written by a person, never taken from a model’s output." />
      {cases.isLoading && <LoadingBlock label="Loading cases…" />}
      {cases.isError && <ErrorState error={cases.error} onRetry={() => void cases.refetch()} title="Couldn’t load cases" />}
      {cases.data && cases.data.length === 0 && <EmptyState icon="flask" title="No cases found">Add case files to the backend evals folder, then reload.</EmptyState>}
      {cases.data && cases.data.length > 0 && (
        <div className="card table-wrap">
          <table className="table cases-table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Tags</th>
                <th scope="col">Template</th>
                <th scope="col">Answer key</th>
                <th scope="col">Review</th>
              </tr>
            </thead>
            <tbody>
              {cases.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="row-link-plain" to={`/evals/cases/${c.id}`}>
                      {c.title}
                    </Link>
                    <div className="small faint">{c.id}</div>
                  </td>
                  <td>
                    <div className="chips tags">
                      {c.tags.map((t, i) => (
                        <span key={t} className={`tag${i === 0 ? ' tag-first' : ''}`}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{tname(c.template_id)}</td>
                  <td className="small">{countsText(c.expectation_counts)}</td>
                  <td>
                    <VerifiedBadge verified={c.verified_by_vet} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
