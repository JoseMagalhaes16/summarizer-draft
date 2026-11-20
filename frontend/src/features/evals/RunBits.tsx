import type { RunStatus, RunSummary } from '../../api/evalTypes';
import { formatNumber } from '../../lib/format';

const LABEL: Record<RunStatus, { text: string; cls: string }> = {
  running: { text: 'Running', cls: 'badge-info' },
  completed: { text: 'Completed', cls: 'badge-accent' },
  failed: { text: 'Failed', cls: 'badge-danger' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = LABEL[status];
  return (
    <span className={`badge ${s.cls}`}>
      <span className="dot" aria-hidden="true" />
      {s.text}
    </span>
  );
}

export function RunProgress({ run }: { run: Pick<RunSummary, 'progress'> }) {
  const { done, total } = run.progress;
  const p = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="run-progress">
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Run progress">
        <span style={{ width: `${p}%` }} />
      </div>
      <span className="small muted nowrap">
        {formatNumber(done)} of {formatNumber(total)} notes
      </span>
    </div>
  );
}
