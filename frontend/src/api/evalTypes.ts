// Mirrors docs/design/eval-spec.md sections 3-7 (wire format is snake_case).
import type { ModelInfo, NoteResult } from './types';

export type EvalProvider = 'mock' | 'bedrock' | 'oracle' | 'null';
export type StructuredMode = 'output_config' | 'tool';
export type Effort = 'low' | 'medium' | 'high';

export const METRIC_KEYS = [
  'schema_valid',
  'field_accuracy',
  'fact_recall',
  'hallucination_free',
  'missing_data_handling',
  'flag_recall',
  'action_recall',
  'faithfulness_proxy',
  'judge_faithfulness',
  'judge_completeness',
  'judge_style_adherence',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

// ----------------------------------------------------------------- cases

export interface ExpectationCounts {
  fields: number;
  facts: number;
  forbidden: number;
  not_discussed: number;
  defaults_expected: number;
  review_flags: number;
  action_items: number;
}

export interface EvalCaseSummary {
  id: string;
  title: string;
  tags: string[];
  template_id: string;
  verified_by_vet: boolean;
  expectation_counts: ExpectationCounts;
}

export interface FieldExpectation {
  section_id: string;
  key: string;
  expected: string;
}
export interface FactExpectation {
  id: string;
  section_id: string | null;
  any_of: string[];
}
export interface ForbiddenExpectation {
  id: string;
  any_of: string[];
}
export interface KeywordExpectation {
  id: string;
  any_of: string[];
}

export interface Expectations {
  fields: FieldExpectation[];
  facts: FactExpectation[];
  forbidden: ForbiddenExpectation[];
  not_discussed: string[];
  defaults_expected: string[];
  review_flags: KeywordExpectation[];
  action_items: KeywordExpectation[];
}

export interface EvalCase {
  id: string;
  title: string;
  tags: string[];
  template_id: string;
  patient: { name?: string; species?: string };
  transcript: string;
  ground_truth: { source: string; verified_by_vet: boolean; notes: string };
  expectations: Expectations;
}

// ------------------------------------------------------------------ runs

export interface RunConfig {
  label: string;
  provider: EvalProvider;
  model_id?: string;
  structured_mode?: StructuredMode;
  effort?: Effort;
  reps: number;
  case_ids?: string[];
  tags?: string[];
  judge?: boolean;
  judge_model_id?: string;
  seed?: number;
}

export type RunStatus = 'running' | 'completed' | 'failed';

export interface MetricStat {
  mean: number;
  ci_low: number;
  ci_high: number;
  n: number;
}
export type MetricStats = Partial<Record<MetricKey, MetricStat>>;

export interface Percentiles {
  p50: number;
  p95: number;
}

export interface RunSummary {
  run_id: string;
  status: RunStatus;
  config: RunConfig;
  created_at: string;
  finished_at?: string | null;
  progress: { done: number; total: number };
  case_count: number;
  metrics: MetricStats;
  by_tag?: Record<string, MetricStats>;
  errors_count: number;
  refusal_rate: number;
  truncated_count: number;
  input_tokens: Percentiles;
  output_tokens: Percentiles;
  latency_ms: Percentiles;
  /** null when the model is missing from the price table. */
  total_cost: number | null;
  /** Half-width of the CI on fact_recall (0..1). */
  noise_floor: number | null;
}

// --------------------------------------------------------------- results

export type ResultStatus = 'ok' | 'refused' | 'truncated' | 'invalid' | 'error';

export interface ForbiddenFound {
  id: string;
  term: string;
  section_id: string | null;
  snippet: string;
}
export interface FieldMismatch {
  section_id: string;
  key: string;
  expected: string;
  got: string;
}

export interface GraderDetails {
  missed_facts: string[];
  forbidden_found: ForbiddenFound[];
  field_mismatches: FieldMismatch[];
  not_discussed_errors: string[];
  missing_flags: string[];
  missing_actions: string[];
}

export interface CaseResult {
  case_id: string;
  case_title?: string;
  tags?: string[];
  rep: number;
  status: ResultStatus;
  stop_reason?: string | null;
  failure_class?: string | null;
  attempts?: number;
  scores: Partial<Record<MetricKey, number | null>>;
  details: GraderDetails;
  result: NoteResult | null;
  model_info: ModelInfo | null;
}

// --------------------------------------------------------------- compare

export type Verdict = 'better' | 'worse' | 'within_noise';

export interface MetricComparison {
  base_mean: number;
  candidate_mean: number;
  delta: number;
  ci_low: number;
  ci_high: number;
  n: number;
  verdict: Verdict;
}

export interface FlippedCase {
  case_id: string;
  case_title?: string;
  rep: number;
  metric: MetricKey;
  base: number | null;
  candidate: number | null;
  direction: 'better' | 'worse';
}

export interface Compare {
  base: RunSummary;
  candidate: RunSummary;
  shared_cases: number;
  metrics: Partial<Record<MetricKey, MetricComparison>>;
  flipped: FlippedCase[];
}
