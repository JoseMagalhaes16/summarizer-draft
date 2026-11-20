import { MAX_TRANSCRIPT_CHARS } from '../../api/types';

export interface NewNoteValidation {
  valid: boolean;
  errors: { template?: string; transcript?: string };
}

export function validateNewNote(templateId: string | null, transcript: string): NewNoteValidation {
  const errors: NewNoteValidation['errors'] = {};
  if (!templateId) errors.template = 'Choose a template.';
  if (!transcript.trim()) errors.transcript = 'Paste or type a transcript.';
  else if (transcript.length > MAX_TRANSCRIPT_CHARS)
    errors.transcript = `Transcript is too long (max ${MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters).`;
  return { valid: Object.keys(errors).length === 0, errors };
}
