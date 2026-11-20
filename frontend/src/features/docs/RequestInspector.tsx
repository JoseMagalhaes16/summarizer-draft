import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';

interface Variant {
  model_id: string;
  body: {
    system: { type: string; text: string }[];
    messages: { role: string; content: { type: string; text: string }[] }[];
    output_config: { format?: { schema: unknown } };
    tools?: unknown[];
  } & Record<string, unknown>;
}
type Example = Record<string, unknown> & { transcript_excerpt: string };

type TemplateKey = 'builtin-soap' | 'builtin-discharge';
type Mode = 'output_config' | 'tool';
type TabKey = 'system' | 'user' | 'schema' | 'body';

const COLLAPSE_LINES = 28;

/** Wrap the three prompt blocks in spans so they can be tinted. */
export function highlightBlocks(text: string): ReactNode[] {
  const re = /<(template|patient|transcript)>[\s\S]*?<\/\1>/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} className={`hl hl-${m[1]}`} data-block={m[1]}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Segmented<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="seg">
      <legend>{legend}</legend>
      <div className="seg-row">
        {options.map(([v, label]) => (
          <label key={v} className={v === value ? 'on' : ''}>
            <input type="radio" name={name} value={v} checked={v === value} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CodeBlock({ text, highlight }: { text: string; highlight?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => text.split('\n').length, [text]);
  const long = lines > COLLAPSE_LINES;
  const collapsed = long && !expanded;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span className="muted small">{lines} lines</span>
        <button type="button" className="btn btn-sm" onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`codeblock-pre${collapsed ? ' is-collapsed' : ''}`} tabIndex={0}>
        {highlight ? <Fragment>{highlightBlocks(text)}</Fragment> : text}
      </pre>
      {long && (
        <button type="button" className="btn btn-ghost btn-sm codeblock-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show all ${lines} lines`}
        </button>
      )}
    </div>
  );
}

export function RequestInspector() {
  const [data, setData] = useState<Example | null>(null);
  const [failed, setFailed] = useState(false);
  const [template, setTemplate] = useState<TemplateKey>('builtin-soap');
  const [mode, setMode] = useState<Mode>('output_config');
  const [tab, setTab] = useState<TabKey>('system');
  const tabsId = useId();

  useEffect(() => {
    let live = true;
    import('./generated/bedrock-request.example.json')
      .then((m) => live && setData((m.default ?? m) as unknown as Example))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="muted">The example request could not be loaded.</p>;
  if (!data) return <p className="muted" role="status">Loading example request…</p>;

  const variant = data[`${template}:${mode}`] as Variant;
  const body = variant.body;
  const texts = {
    system: body.system.map((b) => b.text).join('\n\n'),
    user: body.messages.flatMap((m) => m.content.map((b) => b.text)).join('\n\n'),
    schema: JSON.stringify(mode === 'tool' ? body.tools?.[0] : body.output_config.format?.schema, null, 2),
    body: JSON.stringify(body, null, 2),
  };
  const tabs: [TabKey, string][] = [
    ['system', 'System prompt'],
    ['user', 'User message'],
    ['schema', mode === 'tool' ? 'Tool definition' : 'JSON schema'],
    ['body', 'Full request body'],
  ];

  return (
    <div className="inspector">
      <div className="inspector-controls">
        <Segmented
          legend="Template"
          value={template}
          options={[
            ['builtin-soap', 'SOAP'],
            ['builtin-discharge', 'Client discharge'],
          ]}
          onChange={setTemplate}
        />
        <Segmented
          legend="Mode"
          value={mode}
          options={[
            ['output_config', 'Structured output'],
            ['tool', 'Tool call'],
          ]}
          onChange={setMode}
        />
      </div>
      <p className="muted small inspector-meta">
        Model <code>{variant.model_id}</code>, anthropic_version <code>{String(body.anthropic_version)}</code>, max_tokens <code>{String(body.max_tokens)}</code>
        {mode === 'tool' && (
          <>
            , tool_choice <code>{JSON.stringify(body.tool_choice)}</code>
          </>
        )}
        .
      </p>
      <div role="tablist" aria-label="Request parts" className="inspector-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`${tabsId}-${k}`} aria-selected={tab === k} aria-controls={`${tabsId}-panel`} tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === 'user' && (
          <p className="legend small">
            <span className="hl hl-template">template</span> <span className="hl hl-patient">patient</span> <span className="hl hl-transcript">transcript</span> blocks are tinted.
          </p>
        )}
        <CodeBlock key={`${template}-${mode}-${tab}`} text={texts[tab]} highlight={tab === 'user'} />
      </div>
      <p className="muted small">Generated from the production prompt builder — run <code>scripts/export_prompt_example.py</code> to refresh.</p>
    </div>
  );
}
