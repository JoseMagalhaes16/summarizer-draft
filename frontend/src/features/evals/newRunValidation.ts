import type { EvalProvider, RunConfig } from '../../api/evalTypes';

export interface RunFormState {
  label: string;
  provider: EvalProvider;
  model_id: string;
  structured_mode: 'output_config' | 'tool';
  effort: 'low' | 'medium' | 'high';
  reps: string;
  tags: string[];
  judge: boolean;
}

export type RunFormErrors = Partial<Record<'label' | 'model_id' | 'reps', string>>;

export function validateRunForm(f: RunFormState): RunFormErrors {
  const e: RunFormErrors = {};
  if (!f.label.trim()) e.label = 'Give the run a name so you can find it later.';
  else if (f.label.trim().length > 80) e.label = 'Keep the name under 80 characters.';
  if (f.provider === 'bedrock' && !f.model_id.trim()) e.model_id = 'Enter the Bedrock model id to use.';
  const reps = Number(f.reps);
  if (!f.reps.trim() || !Number.isInteger(reps) || reps < 1 || reps > 5) e.reps = 'Repetitions must be a whole number from 1 to 5.';
  return e;
}

export function toRunConfig(f: RunFormState): RunConfig {
  const bedrock = f.provider === 'bedrock';
  return {
    label: f.label.trim(),
    provider: f.provider,
    reps: Number(f.reps),
    ...(bedrock ? { model_id: f.model_id.trim(), structured_mode: f.structured_mode, effort: f.effort, judge: f.judge } : {}),
    ...(f.tags.length ? { tags: f.tags } : {}),
  };
}

/** The same run as a CLI call, shown when the server won't start runs. */
export function cliCommand(cfg: RunConfig): string {
  const parts = ['python -m vetscribe.evals.cli run', `--provider ${cfg.provider}`, `--label "${cfg.label.replace(/"/g, '\\"')}"`, `--reps ${cfg.reps}`];
  if (cfg.model_id) parts.push(`--model-id ${cfg.model_id}`);
  if (cfg.effort) parts.push(`--effort ${cfg.effort}`);
  if (cfg.judge) parts.push('--judge');
  return parts.join(' ');
}
