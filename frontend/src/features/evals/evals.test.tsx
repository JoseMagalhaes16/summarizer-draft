import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderApp } from '../../test/utils';
import type { Compare, EvalCaseSummary, MetricStat, RunSummary, CaseResult } from '../../api/evalTypes';
import { MetricTile } from './MetricMeter';
import { ResultCell } from './ResultCell';
import { ComparePage } from './ComparePage';
import { NewRunPage } from './NewRunPage';
import { RunDetailPage } from './RunDetailPage';
import { RunsPage } from './RunsPage';

const stat = (mean: number, lo: number, hi: number, n = 16): MetricStat => ({ mean, ci_low: lo, ci_high: hi, n });

function run(p: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'R1',
    status: 'completed',
    config: { label: 'Mock baseline', provider: 'mock', reps: 2 },
    created_at: '2026-11-19T10:00:00Z',
    finished_at: '2026-11-19T10:01:00Z',
    progress: { done: 16, total: 16 },
    case_count: 8,
    metrics: { fact_recall: stat(0.78, 0.69, 0.87), hallucination_free: stat(0.75, 0.5, 0.9) },
    errors_count: 2,
    refusal_rate: 0.0625,
    truncated_count: 1,
    input_tokens: { p50: 800, p95: 1200 },
    output_tokens: { p50: 500, p95: 900 },
    latency_ms: { p50: 60, p95: 100 },
    total_cost: null,
    noise_floor: 0.09,
    ...p,
  };
}

const noDetails = { missed_facts: [], forbidden_found: [], field_mismatches: [], not_discussed_errors: [], missing_flags: [], missing_actions: [] };
const rows: CaseResult[] = [
  { case_id: 'c1', case_title: 'Otitis case', rep: 1, status: 'ok', scores: { fact_recall: 1, hallucination_free: 0 }, details: { ...noDetails, forbidden_found: [{ id: 'x', term: 'amoxicillin', section_id: 'plan', snippet: '…start amoxicillin…' }] }, result: null, model_info: null },
  { case_id: 'c2', case_title: 'Dental case', rep: 1, status: 'ok', scores: { fact_recall: 0.5, hallucination_free: 1 }, details: noDetails, result: null, model_info: null },
  { case_id: 'c3', case_title: 'Phone case', rep: 1, status: 'ok', scores: { fact_recall: 0, hallucination_free: null }, details: noDetails, result: null, model_info: null },
];

describe('MetricTile', () => {
  it('shows mean, interval half-width and n', () => {
    renderApp(<MetricTile metric="fact_recall" stat={stat(0.78, 0.69, 0.87, 16)} />);
    expect(screen.getByText('Key facts captured')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('± 9 pts')).toBeInTheDocument();
    expect(screen.getByText(/n = 16 notes/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /78%, 95% interval 69% to 87%/ })).toBeInTheDocument();
  });
});

describe('ResultCell', () => {
  it('uses words, not just colour', () => {
    renderApp(
      <>
        <ResultCell value={1} />
        <ResultCell value={0} />
        <ResultCell value={0.5} />
        <ResultCell value={null} />
      </>,
    );
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.getByText(/Partial 50%/)).toBeInTheDocument();
    expect(screen.getByText('n.a.')).toBeInTheDocument();
  });
});

describe('Run detail', () => {
  const open = () => renderApp(<RunDetailPage />, { route: '/evals/runs/R1', path: '/evals/runs/:id' });
  beforeEach(() => {
    server.use(
      http.get('*/v1/evals/runs/R1', () => HttpResponse.json(run())),
      http.get('*/v1/evals/runs/R1/results', () => HttpResponse.json({ items: rows })),
    );
  });

  it('keeps errors/refusals/truncations apart from quality scores', async () => {
    open();
    const health = await screen.findByRole('heading', { name: /errors, refusals and cut-off notes/i });
    const section = health.closest('section')!;
    expect(within(section).getByText('Service errors')).toBeInTheDocument();
    expect(within(section).getByText('6%')).toBeInTheDocument();
    expect(within(section).getByText(/not counted as the model getting things wrong/i)).toBeInTheDocument();
    const quality = screen.getByRole('heading', { name: 'Quality scores' }).closest('section')!;
    expect(within(quality).queryByText('Service errors')).toBeNull();
    expect(within(quality).getByText(/no combined overall score/i)).toBeInTheDocument();
  });

  it('shows per-case cells as text and lists hallucination failures', async () => {
    open();
    const otitis = await screen.findAllByText('Otitis case');
    expect(otitis.length).toBeGreaterThan(0);
    const rowsEls = screen.getAllByRole('row');
    const r1 = rowsEls.find((r) => within(r).queryByText('Otitis case') && within(r).queryByText('Pass'))!;
    expect(within(r1).getByText('Fail')).toBeInTheDocument();
    const r2 = rowsEls.find((r) => within(r).queryByText('Dental case'))!;
    expect(within(r2).getByText(/Partial 50%/)).toBeInTheDocument();
    const r3 = rowsEls.find((r) => within(r).queryByText('Phone case'))!;
    expect(within(r3).getByText('n.a.')).toBeInTheDocument();
    expect(screen.getByText(/found “amoxicillin”/)).toBeInTheDocument();
  });

  it('expands a row to show what was missed', async () => {
    server.use(http.get('*/v1/evals/cases/c1', () => HttpResponse.json({ id: 'c1', title: 'Otitis case', tags: [], template_id: 't', patient: {}, transcript: 'Vet: hello there', ground_truth: { source: 'x', verified_by_vet: true, notes: '' }, expectations: { fields: [], facts: [], forbidden: [], not_discussed: [], defaults_expected: [], review_flags: [], action_items: [] } })));
    open();
    const toggle = (await screen.findAllByRole('button', { name: /Otitis case/ }))[0];
    await userEvent.click(toggle);
    expect(await screen.findByText('Invented or forbidden details found')).toBeInTheDocument();
    expect(screen.getByText('…start amoxicillin…')).toBeInTheDocument();
  });
});

describe('Runs list polling', () => {
  it('polls while a run is running and stops once it completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get('*/v1/evals/runs', () => {
        calls++;
        const done = calls >= 3;
        return HttpResponse.json({ items: [run({ status: done ? 'completed' : 'running', progress: { done: done ? 16 : 4, total: 16 } })] });
      }),
    );
    renderApp(<RunsPage />, { route: '/evals', path: '/evals' });
    await screen.findByText('Mock baseline');
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(calls).toBe(3));
    await screen.findByText('Completed');
    await vi.advanceTimersByTimeAsync(7000);
    expect(calls).toBe(3);
    vi.useRealTimers();
  });

  it('invites a first Mock and Oracle run when empty', async () => {
    server.use(http.get('*/v1/evals/runs', () => HttpResponse.json({ items: [] })));
    renderApp(<RunsPage />, { route: '/evals', path: '/evals' });
    expect(await screen.findByRole('link', { name: 'Start a Mock run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start an Oracle run' })).toBeInTheDocument();
  });
});

describe('New run form', () => {
  const cases: EvalCaseSummary[] = [
    { id: 'a', title: 'A', tags: ['sick', 'canine'], template_id: 't', verified_by_vet: true, expectation_counts: { fields: 0, facts: 1, forbidden: 0, not_discussed: 0, defaults_expected: 0, review_flags: 0, action_items: 0 } },
  ];
  beforeEach(() => {
    server.use(
      http.get('*/v1/evals/cases', () => HttpResponse.json({ items: cases })),
      http.get('*/v1/health', () => HttpResponse.json({ status: 'ok', llm_provider: 'mock', storage: 'memory' })),
    );
  });
  const open = () => renderApp(<NewRunPage />, { route: '/evals/new', path: '/evals/new' });

  it('validates name, bedrock model id and repetitions', async () => {
    open();
    await screen.findByText('sick');
    await userEvent.click(screen.getByRole('radio', { name: /Bedrock/ }));
    const reps = screen.getByLabelText('Repetitions');
    await userEvent.clear(reps);
    await userEvent.type(reps, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(await screen.findByText(/Give the run a name/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the Bedrock model id/)).toBeInTheDocument();
    expect(screen.getByText(/from 1 to 5/)).toBeInTheDocument();
  });

  it('explains a 403 and shows the CLI command', async () => {
    server.use(http.post('*/v1/evals/runs', () => HttpResponse.json({ error: { code: 'EVALS_TRIGGER_DISABLED', message: 'Triggering is disabled.' } }, { status: 403 })));
    open();
    await screen.findByText('sick');
    await userEvent.type(screen.getByLabelText(/Run name/), 'My run');
    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(await screen.findByText(/Starting runs from the app is turned off/)).toBeInTheDocument();
    expect(screen.getByText(/python -m vetscribe\.evals\.cli run --provider mock --label "My run"/)).toBeInTheDocument();
  });

  it('explains Oracle and Null as harness checks', async () => {
    open();
    expect(await screen.findByText(/Should score 100%/)).toBeInTheDocument();
    expect(screen.getByText(/about 0% on recall/)).toBeInTheDocument();
  });
});

describe('Compare', () => {
  it('shows a verdict chip per metric and the cases that changed', async () => {
    const base = run({ run_id: 'B', config: { label: 'Base run', provider: 'mock', reps: 2 } });
    const cand = run({ run_id: 'C', config: { label: 'Candidate run', provider: 'mock', reps: 2 } });
    const cmp: Compare = {
      base,
      candidate: cand,
      shared_cases: 8,
      metrics: {
        fact_recall: { base_mean: 0.6, candidate_mean: 0.8, delta: 0.2, ci_low: 0.05, ci_high: 0.35, n: 16, verdict: 'better' },
        hallucination_free: { base_mean: 0.9, candidate_mean: 0.7, delta: -0.2, ci_low: -0.4, ci_high: -0.05, n: 16, verdict: 'worse' },
        flag_recall: { base_mean: 0.5, candidate_mean: 0.52, delta: 0.02, ci_low: -0.1, ci_high: 0.14, n: 10, verdict: 'within_noise' },
      },
      flipped: [{ case_id: 'c1', case_title: 'Otitis case', rep: 1, metric: 'hallucination_free', base: 1, candidate: 0, direction: 'worse' }],
    };
    server.use(
      http.get('*/v1/evals/runs', () => HttpResponse.json({ items: [base, cand] })),
      http.get('*/v1/evals/compare', () => HttpResponse.json(cmp)),
    );
    renderApp(<ComparePage />, { route: '/evals/compare?base=B&candidate=C', path: '/evals/compare' });
    expect(await screen.findByText('Better')).toBeInTheDocument();
    expect(screen.getByText('Within noise')).toBeInTheDocument();
    expect(screen.getAllByText('Worse').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('+20 pts')).toBeInTheDocument();
    const changed = screen.getByRole('heading', { name: 'Cases that changed' }).closest('section')!;
    expect(within(changed).getByText('Otitis case')).toBeInTheDocument();
  });
});
