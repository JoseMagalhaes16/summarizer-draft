import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCreateNote, useTemplates } from '../../api/hooks';
import type { Note } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../lib/errors';
import { TemplatePicker } from './TemplatePicker';

/** Create a second note from this note's transcript and patient details, with another template. */
export function DraftAnotherDialog({ note, open, onClose }: { note: Note; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const templates = useTemplates();
  const create = useCreateNote();
  const [templateId, setTemplateId] = useState<string | null>(null);

  const list = templates.data ?? [];
  // Default to the first template that isn't the current one.
  const selected = templateId ?? list.find((t) => t.id !== note.template_id)?.id ?? note.template_id;

  function submit() {
    create.mutate(
      { template_id: selected, transcript: note.transcript, patient: note.patient, clinician: note.clinician },
      {
        onSuccess: (n) => {
          onClose();
          toast.show('Note drafting started');
          void navigate(`/notes/${n.id}`);
        },
        onError: (e) => toast.show(errorMessage(e, 'Couldn’t start the new note. Try again.'), 'error'),
      },
    );
  }

  return (
    <ConfirmDialog open={open} title="Draft another note" confirmLabel="Draft note" busy={create.isPending} onConfirm={submit} onCancel={onClose}>
      <p className="muted">
        This makes a new note from the same transcript and patient details. <strong>{note.template_name}</strong> stays as it is.
      </p>
      {templates.isLoading && <p className="muted" role="status">Loading templates…</p>}
      {templates.isError && <p role="alert">Couldn’t load templates. Close this and try again.</p>}
      {list.length > 0 && <TemplatePicker templates={list} value={selected} onChange={setTemplateId} currentId={note.template_id} />}
    </ConfirmDialog>
  );
}
