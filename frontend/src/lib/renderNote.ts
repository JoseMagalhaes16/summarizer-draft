import type { Note, NoteResult, ResultSection, Template } from '../api/types';

export type MissingBehaviorMap = Record<string, Template['sections'][number]['missing_behavior']>;

export function missingBehaviors(template: Template | undefined): MissingBehaviorMap {
  const map: MissingBehaviorMap = {};
  for (const s of template?.sections ?? []) map[s.id] = s.missing_behavior;
  return map;
}

/** Is this section hidden from the final note (omit + not discussed)? */
export function isOmitted(section: ResultSection, behaviors: MissingBehaviorMap): boolean {
  return section.not_discussed && (behaviors[section.section_id] ?? 'omit') === 'omit';
}

export function renderSectionText(section: ResultSection, behaviors: MissingBehaviorMap): string {
  const b = behaviors[section.section_id] ?? 'omit';
  let body: string;
  if (section.not_discussed) {
    body = b === 'state_not_discussed' ? 'Not discussed.' : '';
  } else if (section.format === 'paragraph') {
    body = section.content.trim();
  } else if (section.format === 'bullets') {
    body = section.items.map((i) => `- ${i}`).join('\n');
  } else {
    body = section.fields.map((f) => `${f.label}: ${f.value}`).join('\n');
  }
  return `${section.title}\n${body}`.trimEnd();
}

/** Client-side fallback mirroring the backend's render_note_text (spec 4.5). */
export function renderNoteText(result: NoteResult, template: Template | undefined): string {
  const behaviors = missingBehaviors(template);
  const parts: string[] = [];
  for (const s of result.sections) {
    if (isOmitted(s, behaviors)) continue;
    parts.push(renderSectionText(s, behaviors));
  }
  if (result.action_items.length) {
    parts.push(`Action items\n${result.action_items.map((i) => `- ${i}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Prefer the server's rendered_text; fall back to a client-side render. */
export function fullNoteText(note: Note): string {
  return note.rendered_text ?? (note.result ? renderNoteText(note.result, note.template_snapshot) : '');
}
