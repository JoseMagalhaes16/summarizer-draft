import { Link } from 'react-router';
import { useNotes } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingBlock, PageHead, StatusBadge } from '../../components/ui';
import { formatDateTime, patientLabel, relativeTime, truncate } from '../../lib/format';

export function NotesPage() {
  const notes = useNotes();

  return (
    <div className="page">
      <PageHead
        title="Notes"
        subtitle="Recent notes, newest first."
        actions={
          <Link to="/" className="btn btn-primary">
            New note
          </Link>
        }
      />
      {notes.isLoading && <LoadingBlock label="Loading notes…" />}
      {notes.isError && <ErrorState error={notes.error} onRetry={() => void notes.refetch()} title="Couldn’t load notes" />}
      {notes.data && notes.data.length === 0 && (
        <EmptyState title="No notes yet" action={<Link to="/" className="btn btn-primary">Draft your first note</Link>}>
          Paste a consult transcript and your first draft will appear here.
        </EmptyState>
      )}
      {notes.data && notes.data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Template</th>
                <th scope="col">Status</th>
                <th scope="col">Summary</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {notes.data.map((n) => (
                <tr key={n.id}>
                  <td>
                    <Link className="row-link" to={`/notes/${n.id}`}>
                      {patientLabel(n.patient)}
                    </Link>
                    {n.patient.species && <div className="muted small">{n.patient.species}</div>}
                  </td>
                  <td>{n.template_name}</td>
                  <td>
                    <StatusBadge status={n.status} />
                  </td>
                  <td className="summary-cell muted">{n.visit_summary ? truncate(n.visit_summary, 110) : <span className="faint">Not ready yet</span>}</td>
                  <td className="nowrap">
                    <time dateTime={n.created_at} title={formatDateTime(n.created_at)}>
                      {relativeTime(n.created_at)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
