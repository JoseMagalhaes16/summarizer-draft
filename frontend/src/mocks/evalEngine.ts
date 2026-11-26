import type {
  CaseResult,
  Compare,
  EvalCase,
  EvalCaseSummary,
  FlippedCase,
  GraderDetails,
  MetricComparison,
  MetricKey,
  MetricStat,
  MetricStats,
  Percentiles,
  RunConfig,
  RunSummary,
} from '../api/evalTypes';
import { METRIC_KEYS } from '../api/evalTypes';
import type { NoteResult, ResultSection } from '../api/types';
import { humanise } from '../lib/format';
import { MockApiError } from './engine';
import { SEED_EVAL_CASES, type SeedCase } from './evalSeed';

// ------------------------------------------------------------------ utils

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rngFor(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}
const pctiles = (xs: number[]): Percentiles => ({ p50: Math.round(quantile(xs, 0.5)), p95: Math.round(quantile(xs, 0.95)) });

function wilson(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function bootstrapCi(xs: number[], seed: string): [number, number] {
  const r = rngFor(seed);
  const ms: number[] = [];
  for (let b = 0; b < 400; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)];
    ms.push(s / xs.length);
  }
  return [quantile(ms, 0.025), quantile(ms, 0.975)];
}

export function statOf(xs: number[], seed: string): MetricStat {
  const n = xs.length;
  const m = mean(xs);
  const binary = xs.every((x) => x === 0 || x === 1);
  const [lo, hi] = binary ? wilson(xs.filter((x) => x === 1).length, n) : bootstrapCi(xs, seed);
  return { mean: m, ci_low: Math.min(lo, m), ci_high: Math.max(hi, m), n };
}

function metricStats(rows: CaseResult[], seed: string): MetricStats {
  const out: MetricStats = {};
  for (const k of METRIC_KEYS) {
    const xs = rows.filter((r) => r.status === 'ok' || r.status === 'invalid').map((r) => r.scores[k]).filter((v): v is number => typeof v === 'number');
    if (xs.length) out[k] = statOf(xs, `${seed}:${k}`);
  }
  return out;
}

// ------------------------------------------------------------- note builder

const BASE_SECTIONS = ['subjective', 'objective', 'body_systems', 'assessment', 'plan'];
const FIELD_LABELS: Record<string, string> = { weight: 'Weight', temperature: 'Temperature', heart_rate: 'Heart rate', bcs: 'BCS' };

interface Profile {
  /** Probability that each expectation is met. */
  hit: number;
  /** Probability that a forbidden term slips in. */
  slip: number;
  empty?: boolean;
  judge?: boolean;
}

interface Built {
  scores: CaseResult['scores'];
  details: GraderDetails;
  result: NoteResult;
}

function build(c: SeedCase, p: Profile, rnd: () => number): Built {
  const e = c.expectations;
  const details: GraderDetails = { missed_facts: [], forbidden_found: [], field_mismatches: [], not_discussed_errors: [], missing_flags: [], missing_actions: [] };
  const ids = new Set(BASE_SECTIONS);
  [...e.not_discussed, ...e.defaults_expected, ...e.facts.map((f) => f.section_id), ...e.fields.map((f) => f.section_id)].forEach((s) => s && ids.add(s));
  const secs = new Map<string, ResultSection>();
  for (const id of ids) {
    secs.set(id, { section_id: id, title: humanise(id), format: id === 'objective' ? 'key_value' : id === 'plan' || id.endsWith('findings') || id === 'home_care' ? 'bullets' : 'paragraph', content: '', items: [], fields: [], not_discussed: false, used_defaults: false });
  }
  const say = (id: string, text: string) => {
    const s = secs.get(id)!;
    if (s.format === 'bullets') s.items.push(text);
    else s.content = s.content ? `${s.content} ${text}.` : `${text}.`;
  };

  // fields
  const fieldScores: number[] = [];
  for (const f of e.fields) {
    const s = secs.get(f.section_id)!;
    s.format = 'key_value';
    const ok = !p.empty && rnd() < p.hit;
    const got = p.empty ? '' : ok ? f.expected : f.expected === '' ? '98 bpm' : f.expected.replace(/[\d.]+/, (m) => String(+(Number(m) * 1.1).toFixed(1)));
    const emptyOk = p.empty && f.expected === '';
    if (!(ok || emptyOk)) details.field_mismatches.push({ section_id: f.section_id, key: f.key, expected: f.expected, got });
    fieldScores.push(ok || emptyOk ? 1 : 0);
    if (!p.empty) s.fields.push({ key: f.key, label: FIELD_LABELS[f.key] ?? humanise(f.key), value: got });
  }
  // facts
  let hits = 0;
  for (const f of e.facts) {
    if (!p.empty && rnd() < p.hit) {
      hits++;
      say(f.section_id ?? 'assessment', f.say);
    } else details.missed_facts.push(f.id);
  }
  // forbidden
  let slipped = false;
  for (const f of e.forbidden) {
    if (!p.empty && rnd() < p.slip) {
      slipped = true;
      const term = f.any_of[0];
      const snippet = `…plan to start ${term} and review in a week…`;
      details.forbidden_found.push({ id: f.id, term, section_id: 'plan', snippet });
      say('plan', `Start ${term} and review in a week`);
    }
  }
  // missing data
  const mdTotal = e.not_discussed.length + e.defaults_expected.length;
  let mdOk = 0;
  for (const id of e.not_discussed) {
    if (!p.empty && rnd() < p.hit) {
      secs.get(id)!.not_discussed = true;
      mdOk++;
    } else {
      details.not_discussed_errors.push(id);
      if (!p.empty) say(id, 'No concerns noted');
    }
  }
  for (const id of e.defaults_expected) {
    if (!p.empty && rnd() < p.hit) {
      const s = secs.get(id)!;
      s.used_defaults = true;
      s.content = 'BAR, MM pink and moist, CRT under 2 s, heart and lungs normal.';
      mdOk++;
    } else details.not_discussed_errors.push(id);
  }
  // flags + actions
  const flags: string[] = [];
  let flagHits = 0;
  for (const f of e.review_flags) {
    if (!p.empty && rnd() < p.hit) {
      flagHits++;
      flags.push(`Confirm the ${f.any_of[0]} before filing`);
    } else details.missing_flags.push(f.id);
  }
  const actions: string[] = [];
  let actHits = 0;
  for (const a of e.action_items) {
    if (!p.empty && rnd() < p.hit) {
      actHits++;
      actions.push(`Follow-up: ${a.any_of[0]}`);
    } else details.missing_actions.push(a.id);
  }

  const frac = (k: number, n: number) => (n ? k / n : null);
  const scores: CaseResult['scores'] = {
    schema_valid: 1,
    field_accuracy: frac(fieldScores.reduce((a, b) => a + b, 0), e.fields.length),
    fact_recall: frac(hits, e.facts.length),
    hallucination_free: e.forbidden.length ? (slipped ? 0 : 1) : null,
    missing_data_handling: frac(mdOk, mdTotal),
    flag_recall: frac(flagHits, e.review_flags.length),
    action_recall: frac(actHits, e.action_items.length),
    faithfulness_proxy: p.empty ? null : Math.min(1, +(p.hit >= 1 ? 1 : 0.78 + rnd() * 0.2).toFixed(2)),
  };
  if (p.judge) {
    scores.judge_faithfulness = +(0.75 + rnd() * 0.25).toFixed(2);
    scores.judge_completeness = +(0.6 + rnd() * 0.3).toFixed(2);
    scores.judge_style_adherence = +(0.8 + rnd() * 0.2).toFixed(2);
  }
  const sections = [...secs.values()].sort((a, b) => BASE_SECTIONS.indexOf(a.section_id) - BASE_SECTIONS.indexOf(b.section_id));
  const result: NoteResult = {
    visit_summary: p.empty ? '' : `${c.patient.name ?? 'Patient'} seen. ${e.facts[0]?.say ?? 'Visit recorded'}.`,
    sections: p.empty ? sections.map((s) => ({ ...s, not_discussed: false })) : sections,
    action_items: actions,
    review_flags: flags,
  };
  return { scores, details, result };
}

const NULL_METRICS_FOR_NON_OK: CaseResult['scores'] = {};

// ---------------------------------------------------------------- engine

interface StoredRun {
  run_id: string;
  config: RunConfig;
  created_at: number;
  rows: CaseResult[];
  /** ms from created_at until completion; 0 means already complete. */
  duration: number;
  price?: { in: number; out: number };
}

const PROFILES: Record<string, Profile> = {
  oracle: { hit: 1, slip: 0 },
  null: { hit: 0, slip: 0, empty: true },
  mock: { hit: 0.62, slip: 0.3 },
  bedrock: { hit: 0.92, slip: 0.06 },
};

export interface EvalMockOptions {
  /** ms for a created run to go from running to completed. */
  runDurationMs?: number;
  seedRuns?: boolean;
  /** Behave like LLM_PROVIDER=none: mock/bedrock runs are refused. */
  aiOff?: boolean;
}

export class EvalMockEngine {
  cases: SeedCase[] = SEED_EVAL_CASES;
  runs: StoredRun[] = [];
  readonly runDurationMs: number;
  private seq = 0;
  private aiOff = false;

  constructor(opts: EvalMockOptions = {}) {
    this.runDurationMs = opts.runDurationMs ?? 4000;
    this.aiOff = opts.aiOff === true;
    if (opts.seedRuns !== false) this.seed();
  }

  private mkId(): string {
    this.seq++;
    return `01JEVAL${Date.now().toString(36).toUpperCase()}${String(this.seq).padStart(4, '0')}`;
  }

  private produce(cfg: RunConfig, runId: string, opts: { errorAt?: number; truncatedAt?: number } = {}): CaseResult[] {
    const cases = this.cases.filter((c) => (!cfg.case_ids?.length || cfg.case_ids.includes(c.id)) && (!cfg.tags?.length || c.tags.some((t) => cfg.tags!.includes(t))));
    const prof = { ...PROFILES[cfg.provider], judge: !!cfg.judge };
    const rows: CaseResult[] = [];
    for (const c of cases) {
      for (let rep = 1; rep <= cfg.reps; rep++) {
        const rnd = rngFor(`${runId}:${c.id}:${rep}`);
        const idx = rows.length;
        const base = { case_id: c.id, case_title: c.title, tags: c.tags, rep, attempts: 1 };
        const model_id = cfg.provider === 'bedrock' ? (cfg.model_id ?? 'bedrock') : `${cfg.provider}-v1`;
        const tokens = { input_tokens: 500 + Math.round(rnd() * 700), output_tokens: 350 + Math.round(rnd() * 500) };
        if (idx === opts.errorAt) {
          rows.push({ ...base, status: 'error', failure_class: 'THROTTLED', attempts: 4, scores: NULL_METRICS_FOR_NON_OK, details: emptyDetails(), result: null, model_info: null });
          continue;
        }
        if (idx === opts.truncatedAt) {
          rows.push({ ...base, status: 'truncated', stop_reason: 'max_tokens', scores: NULL_METRICS_FOR_NON_OK, details: emptyDetails(), result: null, model_info: { provider: cfg.provider, model_id, ...tokens, latency_ms: 9000 } });
          continue;
        }
        const b = build(c, prof, rnd);
        const latency = cfg.provider === 'bedrock' ? 5200 + Math.round(rnd() * 5000) : 40 + Math.round(rnd() * 60);
        rows.push({ ...base, status: 'ok', stop_reason: 'end_turn', scores: b.scores, details: b.details, result: b.result, model_info: { provider: cfg.provider, model_id, ...tokens, latency_ms: latency } });
      }
    }
    return rows;
  }

  private seed() {
    const now = Date.now();
    const mk = (id: string, ageMs: number, cfg: RunConfig, opts: { errorAt?: number; truncatedAt?: number } = {}, price?: StoredRun['price']) => {
      this.runs.push({ run_id: id, config: cfg, created_at: now - ageMs, rows: this.produce(cfg, id, opts), duration: 0, price });
    };
    const h = 3600_000;
    mk('01JEVAL0000000000000000001', 70 * h, { label: 'Oracle sanity check', provider: 'oracle', reps: 2 });
    mk('01JEVAL0000000000000000002', 26 * h, { label: 'Mock baseline', provider: 'mock', reps: 2 }, { truncatedAt: 5 });
    mk('01JEVAL0000000000000000003', 3 * h, { label: 'Opus, effort medium', provider: 'bedrock', model_id: 'us.anthropic.claude-opus-5-5', structured_mode: 'output_config', effort: 'medium', reps: 2, judge: true }, { errorAt: 9 }, { in: 15, out: 75 });
  }

  // ------------------------------------------------------------- cases
  listCases(): { items: EvalCaseSummary[] } {
    return {
      items: this.cases.map((c) => ({
        id: c.id,
        title: c.title,
        tags: c.tags,
        template_id: c.template_id,
        verified_by_vet: c.ground_truth.verified_by_vet,
        expectation_counts: {
          fields: c.expectations.fields.length,
          facts: c.expectations.facts.length,
          forbidden: c.expectations.forbidden.length,
          not_discussed: c.expectations.not_discussed.length,
          defaults_expected: c.expectations.defaults_expected.length,
          review_flags: c.expectations.review_flags.length,
          action_items: c.expectations.action_items.length,
        },
      })),
    };
  }
  getCase(id: string): EvalCase {
    const c = this.cases.find((x) => x.id === id);
    if (!c) throw new MockApiError(404, 'NOT_FOUND', 'Eval case not found');
    return { ...c, expectations: { ...c.expectations, facts: c.expectations.facts.map(({ id: fid, section_id, any_of }) => ({ id: fid, section_id, any_of })) } };
  }

  // -------------------------------------------------------------- runs
  private progress(r: StoredRun) {
    const total = r.rows.length;
    if (r.duration === 0) return { done: total, total, status: 'completed' as const };
    const f = Math.min(1, (Date.now() - r.created_at) / r.duration);
    return f >= 1 ? { done: total, total, status: 'completed' as const } : { done: Math.floor(f * total), total, status: 'running' as const };
  }

  private summary(r: StoredRun): RunSummary {
    const pr = this.progress(r);
    const rows = r.rows.slice(0, pr.done);
    const finished = pr.status === 'completed';
    const scored = rows.filter((x) => x.status === 'ok');
    const metrics = finished ? metricStats(rows, r.run_id) : {};
    const by_tag: Record<string, MetricStats> = {};
    if (finished) {
      for (const t of new Set(rows.map((x) => x.tags?.[0] ?? ''))) if (t) by_tag[t] = metricStats(rows.filter((x) => x.tags?.[0] === t), `${r.run_id}:${t}`);
    }
    const mi = scored.map((x) => x.model_info!).filter(Boolean);
    const cost = r.price ? +(mi.reduce((a, m) => a + (m.input_tokens * r.price!.in + m.output_tokens * r.price!.out) / 1e6, 0)).toFixed(2) : null;
    const fr = metrics.fact_recall;
    return {
      run_id: r.run_id,
      status: pr.status,
      config: r.config,
      created_at: new Date(r.created_at).toISOString(),
      finished_at: finished ? new Date(r.created_at + r.duration).toISOString() : null,
      progress: { done: pr.done, total: pr.total },
      case_count: new Set(r.rows.map((x) => x.case_id)).size,
      metrics,
      by_tag: finished ? by_tag : undefined,
      errors_count: rows.filter((x) => x.status === 'error').length,
      refusal_rate: rows.length ? rows.filter((x) => x.status === 'refused').length / rows.length : 0,
      truncated_count: rows.filter((x) => x.status === 'truncated').length,
      input_tokens: pctiles(mi.map((m) => m.input_tokens)),
      output_tokens: pctiles(mi.map((m) => m.output_tokens)),
      latency_ms: pctiles(mi.map((m) => m.latency_ms)),
      total_cost: cost,
      noise_floor: fr ? (fr.ci_high - fr.ci_low) / 2 : null,
    };
  }

  listRuns(): { items: RunSummary[] } {
    return { items: [...this.runs].sort((a, b) => b.created_at - a.created_at).map((r) => ({ ...this.summary(r), by_tag: undefined })) };
  }

  private find(id: string): StoredRun {
    const r = this.runs.find((x) => x.run_id === id);
    if (!r) throw new MockApiError(404, 'NOT_FOUND', 'Eval run not found');
    return r;
  }
  getRun(id: string): RunSummary {
    return this.summary(this.find(id));
  }
  getResults(id: string): { items: CaseResult[] } {
    const r = this.find(id);
    return { items: r.rows.slice(0, this.progress(r).done) };
  }

  createRun(body: unknown): { run_id: string; status: 'running' } {
    const b = (body ?? {}) as Partial<RunConfig>;
    const bad = (m: string) => new MockApiError(400, 'VALIDATION_ERROR', m);
    if (typeof b.label !== 'string' || !b.label.trim()) throw bad('label is required');
    if (!b.provider || !(b.provider in PROFILES)) throw bad('provider must be mock, oracle, null or bedrock');
    const reps = b.reps ?? 2;
    if (!Number.isInteger(reps) || reps < 1 || reps > 5) throw bad('reps must be between 1 and 5');
    if (this.aiOff && (b.provider === 'mock' || b.provider === 'bedrock')) {
      throw new MockApiError(409, 'AI_DISABLED', 'AI drafting is switched off in this environment. Write the note manually.');
    }
    if (/forbid/i.test(b.label)) {
      throw new MockApiError(403, 'EVALS_TRIGGER_DISABLED', 'Starting evaluation runs from the API is turned off on this server (EVALS_ALLOW_TRIGGER=false).');
    }
    if (b.provider === 'bedrock') {
      throw new MockApiError(400, 'VALIDATION_ERROR', 'Bedrock runs need the server to use Bedrock (LLM_PROVIDER=bedrock). This server is using the mock generator.');
    }
    const cfg: RunConfig = { ...b, label: b.label.trim(), provider: b.provider, reps };
    const id = this.mkId();
    const rows = this.produce(cfg, id);
    if (!rows.length) throw bad('No cases match the selected tags');
    this.runs.push({ run_id: id, config: cfg, created_at: Date.now(), rows, duration: this.runDurationMs });
    return { run_id: id, status: 'running' };
  }

  // ----------------------------------------------------------- compare
  compare(baseId: string | null, candId: string | null): Compare {
    if (!baseId || !candId) throw new MockApiError(400, 'VALIDATION_ERROR', 'base and candidate are required');
    const a = this.find(baseId);
    const b = this.find(candId);
    const key = (x: CaseResult) => `${x.case_id}#${x.rep}`;
    const bm = new Map(b.rows.map((x) => [key(x), x]));
    const pairs = a.rows.filter((x) => x.status === 'ok' && bm.get(key(x))?.status === 'ok').map((x) => [x, bm.get(key(x))!] as const);
    if (!pairs.length) throw new MockApiError(400, 'VALIDATION_ERROR', 'The two runs share no scored cases');
    const metrics: Compare['metrics'] = {};
    const flipped: FlippedCase[] = [];
    for (const k of METRIC_KEYS) {
      const pp = pairs.filter(([x, y]) => typeof x.scores[k] === 'number' && typeof y.scores[k] === 'number');
      if (!pp.length) continue;
      const diffs = pp.map(([x, y]) => (y.scores[k] as number) - (x.scores[k] as number));
      const d = mean(diffs);
      const [lo, hi] = bootstrapCi(diffs, `${baseId}:${candId}:${k}`);
      const verdict: MetricComparison['verdict'] = lo > 0 ? 'better' : hi < 0 ? 'worse' : 'within_noise';
      metrics[k] = { base_mean: mean(pp.map(([x]) => x.scores[k] as number)), candidate_mean: mean(pp.map(([, y]) => y.scores[k] as number)), delta: d, ci_low: Math.min(lo, d), ci_high: Math.max(hi, d), n: pp.length, verdict };
      for (const [x, y] of pp) {
        const bv = x.scores[k] as number;
        const cv = y.scores[k] as number;
        if ((bv >= 1) !== (cv >= 1)) flipped.push({ case_id: x.case_id, case_title: x.case_title, rep: x.rep, metric: k as MetricKey, base: bv, candidate: cv, direction: cv > bv ? 'better' : 'worse' });
      }
    }
    return { base: { ...this.summary(a), by_tag: undefined }, candidate: { ...this.summary(b), by_tag: undefined }, shared_cases: new Set(pairs.map(([x]) => x.case_id)).size, metrics, flipped };
  }
}

function emptyDetails(): GraderDetails {
  return { missed_facts: [], forbidden_found: [], field_mismatches: [], not_discussed_errors: [], missing_flags: [], missing_actions: [] };
}
