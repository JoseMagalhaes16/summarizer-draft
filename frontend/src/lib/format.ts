export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const RTF = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (!RTF) return new Date(t).toLocaleString();
  if (abs < 45) return 'just now';
  if (abs < 3600) return RTF.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return RTF.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return RTF.format(Math.round(diff / 86400), 'day');
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function patientLabel(p: { name?: string; species?: string } | undefined): string {
  const name = p?.name?.trim();
  return name || 'Unnamed patient';
}

export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function humanise(s: string): string {
  return capitalise(s.replace(/_/g, ' '));
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Turn a title into a section id candidate matching ^[a-z][a-z0-9_]{0,39}$. */
export function slugify(title: string): string {
  let s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s && !/^[a-z]/.test(s)) s = `s_${s}`;
  return s.slice(0, 40).replace(/_+$/, '');
}
