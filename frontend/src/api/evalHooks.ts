import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Compare, CaseResult, EvalCase, EvalCaseSummary, RunConfig, RunSummary } from './evalTypes';

export const EVAL_POLL_MS = 2000;

export const evalKeys = {
  all: ['evals'] as const,
  cases: ['evals', 'cases'] as const,
  case: (id: string) => ['evals', 'cases', id] as const,
  runs: ['evals', 'runs'] as const,
  run: (id: string) => ['evals', 'runs', id] as const,
  results: (id: string) => ['evals', 'runs', id, 'results'] as const,
  compare: (base: string, cand: string) => ['evals', 'compare', base, cand] as const,
};

export function useEvalCases() {
  return useQuery({
    queryKey: evalKeys.cases,
    queryFn: async ({ signal }) => (await api.get<{ items: EvalCaseSummary[] }>('/v1/evals/cases', signal)).items,
  });
}

export function useEvalCase(id: string | undefined) {
  return useQuery({
    queryKey: evalKeys.case(id ?? ''),
    queryFn: ({ signal }) => api.get<EvalCase>(`/v1/evals/cases/${id}`, signal),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

/** Polls every 2 s while any run is still running. */
export function useEvalRuns() {
  return useQuery({
    queryKey: evalKeys.runs,
    queryFn: async ({ signal }) => (await api.get<{ items: RunSummary[] }>('/v1/evals/runs', signal)).items,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? EVAL_POLL_MS : false),
  });
}

export function useEvalRun(id: string | undefined) {
  return useQuery({
    queryKey: evalKeys.run(id ?? ''),
    queryFn: ({ signal }) => api.get<RunSummary>(`/v1/evals/runs/${id}`, signal),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? EVAL_POLL_MS : false),
  });
}

export function useEvalResults(id: string | undefined, running: boolean) {
  return useQuery({
    queryKey: evalKeys.results(id ?? ''),
    queryFn: async ({ signal }) => (await api.get<{ items: CaseResult[] }>(`/v1/evals/runs/${id}/results`, signal)).items,
    enabled: !!id,
    refetchInterval: running ? EVAL_POLL_MS : false,
  });
}

export function useEvalCompare(base: string | null, candidate: string | null) {
  return useQuery({
    queryKey: evalKeys.compare(base ?? '', candidate ?? ''),
    queryFn: ({ signal }) => api.get<Compare>(`/v1/evals/compare?base=${encodeURIComponent(base!)}&candidate=${encodeURIComponent(candidate!)}`, signal),
    enabled: !!base && !!candidate,
  });
}

export function useCreateEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cfg: RunConfig) => api.post<{ run_id: string; status: 'running' }>('/v1/evals/runs', cfg),
    onSuccess: () => void qc.invalidateQueries({ queryKey: evalKeys.runs }),
  });
}
