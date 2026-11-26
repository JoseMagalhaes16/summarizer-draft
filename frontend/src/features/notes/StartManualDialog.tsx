import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCreateManualNote, useTemplates } from '../../api/hooks';
import type { Note } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../lib/errors';
import { TemplatePicker } from './TemplatePicker';

/** Start a blank manual note for the same patient, on any template. */
export function StartManualDialog({ note, open, onClose }: { note: Note; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const templates = useTemplates();
  const create = useCreateManualNote();
  const [templateId, setTemplateId] = useState<string | null>(null);

  const list = templates.data ?? [];
  const selected = templateId ?? note.template_id;

  function submit() {
    create.mutate(
      { template_id: selected, patient: note.patient, ...(note.clinician ? { clinician: note.clinician } : {}) },
      {
        onSuccess: (n) => {
          onClose();
          toast.show('Note created');
          void navigate(`/notes/${n.id}?edit=1`);
        },
        onError: (e) => toast.show(errorMessage(e, 'Couldn’t create the note. Try again.'), 'error'),
      },
    );
  }

  return (
    <ConfirmDialog open={open} title="Start another note manually" confirmLabel="Create note" busy={create.isPending} onConfirm={submit} onCancel={onClose}>
      <p className="muted">This creates an empty note for the same patient that you fill in yourself. <strong>{note.template_name}</strong> stays as it is.</p>
      {templates.isLoading && <p className="muted" role="status">Loading templates…</p>}
      {templates.isError && <p role="alert">Couldn’t load templates. Close this and try again.</p>}
      {list.length > 0 && <TemplatePicker templates={list} value={selected} onChange={setTemplateId} currentId={note.template_id} />}
    </ConfirmDialog>
  );
}
