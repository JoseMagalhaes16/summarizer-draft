import type { ReactNode } from 'react';
import type { MetricKey, MetricStat } from '../../api/evalTypes';
import { METRIC_INFO, ciPts, pct, tier } from './metrics';

/**
 * Single-ratio meter: a same-hue track, a fill up to the mean, and the 95%
 * interval drawn as a band with end caps. The figures are always printed next
 * to it, so the meter never carries meaning on its own.
 */
export function Meter({ stat, label }: { stat: Pick<MetricStat, 'mean' | 'ci_low' | 'ci_high'>; label: string }) {
  const c = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
  return (
    <div
      className={`meter meter-${tier(stat.mean)}`}
      role="img"
      aria-label={`${label}: ${pct(stat.mean)}, 95% interval ${pct(stat.ci_low)} to ${pct(stat.ci_high)}`}
    >
      <span className="meter-fill" style={{ width: c(stat.mean) }} />
      <span className="meter-ci" style={{ left: c(stat.ci_low), width: `calc(${c(stat.ci_high)} - ${c(stat.ci_low)})` }} />
    </div>
  );
}

export function MetricTile({ metric, stat, children }: { metric: MetricKey; stat: MetricStat; children?: ReactNode }) {
  const info = METRIC_INFO[metric];
  return (
    <div className="metric-tile" data-metric={metric}>
      <h3 className="metric-name">{info.label}</h3>
      <p className="metric-help">{info.help}</p>
      <div className="metric-fig">
        <span className="metric-val">{pct(stat.mean)}</span>
        <span className="metric-ci">± {ciPts(stat)} pts</span>
      </div>
      <Meter stat={stat} label={info.label} />
      <p className="metric-n">
        n = {stat.n} {stat.n === 1 ? 'note' : 'notes'} · 95% interval {pct(stat.ci_low)} to {pct(stat.ci_high)}
      </p>
      {children}
    </div>
  );
}
