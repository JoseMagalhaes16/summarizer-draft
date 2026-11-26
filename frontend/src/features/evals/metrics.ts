import type { EvalProvider, MetricKey, MetricStat, ResultStatus, RunConfig } from '../../api/evalTypes';

export const METRIC_INFO: Record<MetricKey, { label: string; help: string }> = {
  field_accuracy: { label: 'Vitals & fields correct', help: 'Share of expected values (weight, temperature and so on) that match what was said.' },
  fact_recall: { label: 'Key facts captured', help: 'Share of must-have clinical facts that appear in the right section.' },
  hallucination_free: { label: 'No invented facts', help: 'Notes with none of the planted wrong details. One slip in a note counts as a fail.' },
  missing_data_handling: { label: 'Missing data handled', help: 'Sections nobody discussed are marked so, and normal defaults are flagged.' },
  flag_recall: { label: 'Uncertainty flagged', help: 'Share of unclear points (such as an ambiguous dose) that were flagged for review.' },
  action_recall: { label: 'Follow-ups captured', help: 'Share of expected follow-ups that made it into the note.' },
  faithfulness_proxy: { label: 'Grounded in transcript', help: 'Share of note sentences whose content words come from the transcript. A rough offline check.' },
  schema_valid: { label: 'Valid structure', help: 'The model returned a note the app could read.' },
  judge_faithfulness: { label: 'Judge: faithfulness', help: 'A second model rates how well the note sticks to the transcript.' },
  judge_completeness: { label: 'Judge: completeness', help: 'A second model rates whether anything important is missing.' },
  judge_style_adherence: { label: 'Judge: style', help: 'A second model rates whether the note follows the template style.' },
};

export const metricLabel = (k: string): string => (k in METRIC_INFO ? METRIC_INFO[k as MetricKey].label : k.replace(/_/g, ' '));

export const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Half-width of the confidence interval, in percentage points. */
export const ciPts = (s: Pick<MetricStat, 'ci_low' | 'ci_high'>): number => Math.round(((s.ci_high - s.ci_low) / 2) * 100);

export const meanWithCi = (s: MetricStat): string => `${pct(s.mean)} ± ${ciPts(s)} pts`;

export const signedPts = (d: number): string => {
  const v = Math.round(d * 100);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} pts`;
};

export const PROVIDER_LABEL: Record<EvalProvider, string> = {
  mock: 'Mock',
  oracle: 'Oracle (harness check)',
  null: 'Null (harness check)',
  bedrock: 'Bedrock',
};

export function runTitle(c: RunConfig): string {
  if (c.provider === 'bedrock') return c.model_id || 'Bedrock';
  return PROVIDER_LABEL[c.provider];
}

export const STATUS_LABEL: Record<ResultStatus, string> = {
  ok: 'Scored',
  refused: 'Model refused',
  truncated: 'Cut off (too long)',
  invalid: 'Unreadable output',
  error: 'Service error',
};

export type CellKind = 'pass' | 'partial' | 'fail' | 'na';
export function cellKind(v: number | null | undefined): CellKind {
  if (v === null || v === undefined) return 'na';
  if (v >= 1) return 'pass';
  if (v <= 0) return 'fail';
  return 'partial';
}

/** Tier used to pick the meter fill; the figure is always printed beside it. */
export function tier(mean: number): 'good' | 'mid' | 'low' {
  return mean >= 0.8 ? 'good' : mean >= 0.5 ? 'mid' : 'low';
}
