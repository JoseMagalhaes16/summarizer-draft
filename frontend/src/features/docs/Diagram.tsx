import type React from 'react';
import { useEffect, useId, useState } from 'react';

type State = { kind: 'loading' } | { kind: 'ready'; svg: string } | { kind: 'failed' };

const CSS_VARS = {
  accent: '--c-accent',
  accentSoft: '--c-accent-soft',
  accentText: '--c-accent-text',
  surface: '--c-surface',
  surface2: '--c-surface-2',
  border: '--c-border',
  borderStrong: '--c-border-strong',
  text: '--c-text',
  muted: '--c-text-muted',
  warnBg: '--c-warn-bg',
  warnBorder: '--c-warn-border',
  warnText: '--c-warn-text',
} as const;

/** Read the design tokens at render time so diagrams follow light/dark mode. */
function readTokens(): Record<keyof typeof CSS_VARS, string> {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Record<keyof typeof CSS_VARS, string>;
  for (const [k, v] of Object.entries(CSS_VARS)) out[k as keyof typeof CSS_VARS] = cs.getPropertyValue(v).trim() || '#888888';
  return out;
}

/** Appended to flowcharts so `class x accent|flag|quiet` follows the theme. */
function flowchartClasses(t: ReturnType<typeof readTokens>): string {
  return [
    `classDef accent fill:${t.accentSoft},stroke:${t.accent},color:${t.text}`,
    `classDef flag fill:${t.warnBg},stroke:${t.warnBorder},color:${t.warnText}`,
    `classDef quiet fill:${t.surface},stroke:${t.borderStrong},color:${t.muted},stroke-dasharray:5 4`,
  ].join('\n');
}

/** The svg's own width (mermaid writes it as max-width), so small diagrams aren't scaled up. */
function naturalWidth(svg: string): number {
  const m = /max-width:\s*([\d.]+)px/.exec(svg);
  return m ? Math.ceil(Number(m[1])) : 640;
}

let renderCount = 0;

/**
 * A mermaid diagram inside a <figure>. mermaid is imported lazily here and nowhere
 * else, so it stays out of the main bundle. Falls back to the source if it can't render.
 */
export function Diagram({ source, caption, description }: { source: string; caption: string; description: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [scheme, setScheme] = useState(0);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setScheme((n) => n + 1);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        const t = readTokens();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif',
          themeVariables: {
            darkMode: document.documentElement.style.colorScheme === 'dark' || !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
            background: t.surface,
            fontSize: '15px',
            primaryColor: t.surface2,
            primaryTextColor: t.text,
            primaryBorderColor: t.borderStrong,
            secondaryColor: t.accentSoft,
            secondaryTextColor: t.text,
            secondaryBorderColor: t.accent,
            tertiaryColor: t.surface,
            tertiaryTextColor: t.text,
            tertiaryBorderColor: t.border,
            lineColor: t.muted,
            textColor: t.text,
            mainBkg: t.surface2,
            nodeBorder: t.borderStrong,
            clusterBkg: t.surface,
            clusterBorder: t.border,
            titleColor: t.text,
            edgeLabelBackground: t.surface,
            noteBkgColor: t.warnBg,
            noteTextColor: t.warnText,
            noteBorderColor: t.warnBorder,
            actorBkg: t.accentSoft,
            actorBorder: t.accent,
            actorTextColor: t.text,
            actorLineColor: t.borderStrong,
            signalColor: t.text,
            signalTextColor: t.text,
            labelBoxBkgColor: t.surface2,
            labelBoxBorderColor: t.borderStrong,
            labelTextColor: t.text,
            loopTextColor: t.text,
            activationBkgColor: t.accentSoft,
            activationBorderColor: t.accent,
            sequenceNumberColor: t.surface,
            transitionColor: t.muted,
            transitionLabelColor: t.text,
            stateLabelColor: t.text,
            stateBkg: t.surface2,
            labelColor: t.text,
            altBackground: t.surface,
          },
          flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
          sequence: { useMaxWidth: true, mirrorActors: false },
          state: { useMaxWidth: true },
        });
        const text = /^\s*(flowchart|graph)\b/.test(source) ? `${source}\n${flowchartClasses(t)}` : source;
        const { svg } = await mermaid.render(`mmd-${baseId}-${++renderCount}`, text);
        if (!cancelled) setState({ kind: 'ready', svg });
      } catch {
        if (!cancelled) setState({ kind: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, scheme, baseId]);

  return (
    <figure className="diagram">
      <div className="diagram-scroll" tabIndex={0} role="group" aria-label={`${caption} (scrollable)`}>
        {state.kind === 'ready' && (
          <div className="diagram-svg" aria-hidden="true" style={{ '--natural': `${naturalWidth(state.svg)}px` } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: state.svg }} />
        )}
        {state.kind === 'loading' && (
          <p className="diagram-status muted" role="status">
            Drawing diagram…
          </p>
        )}
        {state.kind === 'failed' && (
          <pre className="diagram-fallback" data-testid="diagram-fallback">
            {source}
          </pre>
        )}
      </div>
      <p className="sr-only">{description}</p>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
