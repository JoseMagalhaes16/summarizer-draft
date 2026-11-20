import { Link, useParams } from 'react-router';
import { useEvalCase } from '../../api/evalHooks';
import { Callout, ErrorState, LoadingBlock, PageHead } from '../../components/ui';
import { VerifiedBadge } from './CasesPage';

const sec = (s: string | null) => (s ? s.replace(/_/g, ' ') : 'anywhere in the note');

export function CaseDetailPage() {
  const { id } = useParams();
  const q = useEvalCase(id);
  if (q.isLoading) return <LoadingBlock label="Loading case…" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Couldn’t load this case" />;
  const c = q.data;
  const e = c.expectations;
  return (
    <>
      <div className="crumbs">
        <Link to="/evals/cases">Cases</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{c.id}</span>
      </div>
      <PageHead
        title={c.title}
        subtitle={
          <>
            {c.patient.name} · {c.patient.species} · template {c.template_id}
          </>
        }
        actions={<VerifiedBadge verified={c.ground_truth.verified_by_vet} />}
      />
      <div className="chips tags">
        {c.tags.map((t, i) => (
          <span key={t} className={`tag${i === 0 ? ' tag-first' : ''}`}>
            {t}
          </span>
        ))}
      </div>
      {!c.ground_truth.verified_by_vet && (
        <Callout kind="warn" title="Not vet-verified">
          <p>The answer key was written from the transcript but a vet has not reviewed it yet. Treat scores on this case with care.</p>
        </Callout>
      )}

      <div className="case-grid">
        <section className="stack-sm" aria-labelledby="tr-h">
          <h2 className="section-title" id="tr-h">
            Transcript
          </h2>
          <pre className="transcript-pre card">{c.transcript}</pre>
        </section>

        <section className="stack expect" aria-labelledby="ex-h">
          <h2 className="section-title" id="ex-h">
            What the note should contain
          </h2>
          <Group title="Vitals and fields" n={e.fields.length}>
            <ul>
              {e.fields.map((f) => (
                <li key={`${f.section_id}.${f.key}`}>
                  <strong>{f.key.replace(/_/g, ' ')}</strong>: {f.expected || <em className="muted">empty (not stated)</em>} <span className="muted small">in {sec(f.section_id)}</span>
                </li>
              ))}
            </ul>
          </Group>
          <Group title="Key facts" n={e.facts.length}>
            <ul>
              {e.facts.map((f) => (
                <li key={f.id}>
                  {f.any_of.map((a) => `“${a}”`).join(' or ')} <span className="muted small">in {sec(f.section_id)}</span>
                </li>
              ))}
            </ul>
          </Group>
          <Group title="Must not appear" n={e.forbidden.length} hint="Planted traps for invented details.">
            <ul>
              {e.forbidden.map((f) => (
                <li key={f.id}>{f.any_of.map((a) => `“${a}”`).join(', ')}</li>
              ))}
            </ul>
          </Group>
          <Group title="Sections left as not discussed" n={e.not_discussed.length}>
            <ul>
              {e.not_discussed.map((s) => (
                <li key={s}>{sec(s)}</li>
              ))}
            </ul>
          </Group>
          <Group title="Sections that use normal defaults" n={e.defaults_expected.length}>
            <ul>
              {e.defaults_expected.map((s) => (
                <li key={s}>{sec(s)}</li>
              ))}
            </ul>
          </Group>
          <Group title="Points to flag for review" n={e.review_flags.length}>
            <ul>
              {e.review_flags.map((f) => (
                <li key={f.id}>{f.any_of.map((a) => `“${a}”`).join(' or ')}</li>
              ))}
            </ul>
          </Group>
          <Group title="Follow-ups" n={e.action_items.length}>
            <ul>
              {e.action_items.map((f) => (
                <li key={f.id}>{f.any_of.map((a) => `“${a}”`).join(' or ')}</li>
              ))}
            </ul>
          </Group>
          {c.ground_truth.notes && <p className="small muted">Author’s note: {c.ground_truth.notes}</p>}
        </section>
      </div>
    </>
  );
}

function Group({ title, n, hint, children }: { title: string; n: number; hint?: string; children: React.ReactNode }) {
  if (n === 0) return null;
  return (
    <div className="expect-group">
      <h3>
        {title} <span className="muted small">({n})</span>
      </h3>
      {hint && <p className="small muted">{hint}</p>}
      {children}
    </div>
  );
}
