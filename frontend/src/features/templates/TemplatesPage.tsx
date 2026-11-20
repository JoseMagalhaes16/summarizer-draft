import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDeleteTemplate, useDuplicateTemplate, useTemplates } from '../../api/hooks';
import type { Template } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { EmptyState, ErrorState, LoadingBlock, PageHead } from '../../components/ui';
import { humanise } from '../../lib/format';

export function TemplatesPage() {
  const templates = useTemplates();
  const duplicate = useDuplicateTemplate();
  const del = useDeleteTemplate();
  const navigate = useNavigate();
  const toast = useToast();
  const [toDelete, setToDelete] = useState<Template | null>(null);

  function onDuplicate(t: Template) {
    duplicate.mutate(
      { id: t.id },
      {
        onSuccess: (copy) => {
          toast.show('Template duplicated');
          void navigate(`/templates/${copy.id}`);
        },
        onError: (e) => toast.show(e.message, 'error'),
      },
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Templates"
        subtitle="Templates set the sections and style of each note. Built-in templates are read-only. Duplicate one to make your own."
        actions={
          <Link to="/templates/new" className="btn btn-primary">
            <Icon name="plus" size={16} /> New template
          </Link>
        }
      />
      {templates.isLoading && <LoadingBlock label="Loading templates…" />}
      {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} title="Couldn’t load templates" />}
      {templates.data && templates.data.length === 0 && (
        <EmptyState icon="template" title="No templates yet" action={<Link to="/templates/new" className="btn btn-primary">Create a template</Link>}>
          Create a template to choose the sections of your notes.
        </EmptyState>
      )}
      {templates.data && (
        <ul className="tpl-grid">
          {templates.data.map((t) => (
            <li key={t.id} className="card tpl-card">
              <div className="stack-sm" style={{ flex: 1 }}>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <h2 className="tpl-name">{t.name}</h2>
                  {t.is_builtin && (
                    <span className="badge badge-accent">
                      <Icon name="lock" size={11} /> Built-in
                    </span>
                  )}
                </div>
                <p className="muted tpl-desc">{t.description || 'No description yet.'}</p>
                <p className="muted small">
                  {[
                    humanise(t.appointment_type),
                    t.species.length ? t.species.map(humanise).join(', ') : 'Any species',
                    `${t.sections.length} section${t.sections.length === 1 ? '' : 's'}`,
                    t.style.tone === 'clinical' ? 'Clinical tone' : 'Client-friendly tone',
                  ].join(' · ')}
                </p>
              </div>
              <div className="tpl-actions">
                <button type="button" className="btn btn-sm" onClick={() => onDuplicate(t)} disabled={duplicate.isPending} aria-label={`Duplicate ${t.name}`}>
                  <Icon name="copy" size={14} /> Duplicate
                </button>
                <Link className="btn btn-sm" to={`/templates/${t.id}`} aria-label={`${t.is_builtin ? 'View' : 'Edit'} ${t.name}`}>
                  <Icon name={t.is_builtin ? 'note' : 'edit'} size={14} /> {t.is_builtin ? 'View' : 'Edit'}
                </Link>
                {!t.is_builtin && (
                  <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => setToDelete(t)} aria-label={`Delete ${t.name}`}>
                    <Icon name="trash" size={14} /> Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete template?"
        confirmLabel="Delete template"
        danger
        busy={del.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (!toDelete) return;
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.show('Template deleted');
              setToDelete(null);
            },
            onError: (e) => {
              toast.show(e.message, 'error');
              setToDelete(null);
            },
          });
        }}
      >
        <p>
          <strong>{toDelete?.name}</strong> will be permanently deleted. Existing notes keep their own copy of the template.
        </p>
      </ConfirmDialog>
    </div>
  );
}
