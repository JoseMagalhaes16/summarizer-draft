import type { ReactNode } from 'react';

/** One question: an H2 in the user's words, then a short answer, then detail. */
export function Question({ id, title, answer, children }: { id: string; title: string; answer: ReactNode; children?: ReactNode }) {
  return (
    <section className="doc-q" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="doc-answer">{answer}</p>
      {children}
    </section>
  );
}

export function CodeRefs({ files, adrs = [] }: { files: [path: string, what: string][]; adrs?: string[] }) {
  return (
    <div className="doc-refs">
      <h3>Where in the code</h3>
      <ul>
        {files.map(([p, what]) => (
          <li key={p}>
            <code>{p}</code> <span className="muted">{what}</span>
          </li>
        ))}
        {adrs.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

export function DocTable({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="doc-table-wrap" tabIndex={0} role="group" aria-label={`${caption} (scrollable)`}>
      <table className="doc-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

