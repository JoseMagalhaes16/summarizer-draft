import { transcriptUsage, TRANSCRIPT_LIMIT_HELP } from '../../lib/transcriptLimits';

export interface NewNoteValidation {
  valid: boolean;
  errors: { template?: string; transcript?: string };
}

export function validateNewNote(templateId: string | null, transcript: string): NewNoteValidation {
  const errors: NewNoteValidation['errors'] = {};
  if (!templateId) errors.template = 'Choose a template.';
  if (!transcript.trim()) errors.transcript = 'Paste or type a transcript.';
  else if (transcriptUsage(transcript).over) errors.transcript = `This transcript is too long. ${TRANSCRIPT_LIMIT_HELP}`;
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Manual notes need only a template; the reference transcript is optional but has the same size limits. */
export function validateManualNote(templateId: string | null, reference: string): NewNoteValidation {
  const errors: NewNoteValidation['errors'] = {};
  if (!templateId) errors.template = 'Choose a template.';
  if (reference.trim() && transcriptUsage(reference).over) errors.transcript = `This transcript is too long. ${TRANSCRIPT_LIMIT_HELP}`;
  return { valid: Object.keys(errors).length === 0, errors };
}
