import type { NoteResult, ResultSection } from '../api/types';

export function sectionHasContent(s: ResultSection): boolean {
  if (s.format === 'paragraph') return s.content.trim() !== '';
  if (s.format === 'bullets') return s.items.some((i) => i.trim() !== '');
  return s.fields.some((f) => f.value.trim() !== '');
}

function tidySection(s: ResultSection): ResultSection {
  return { ...s, items: s.items.filter((i) => i.trim() !== '') };
}

function sameContent(a: ResultSection, b: ResultSection): boolean {
  return a.content === b.content && JSON.stringify(a.items) === JSON.stringify(b.items) && JSON.stringify(a.fields) === JSON.stringify(b.fields);
}

/**
 * Turns the vet's edited draft into the NoteResult to save.
 *
 * - blank bullets and follow-ups are dropped;
 * - a section whose content the vet changed is now written or confirmed by them:
 *   `used_defaults` becomes false, and `not_discussed` follows whether it has content;
 * - a section left as it was keeps `used_defaults`; it is only marked discussed if it has content.
 */
export function finalizeResult(original: NoteResult, draft: NoteResult): NoteResult {
  const before = new Map(original.sections.map((s) => [s.section_id, tidySection(s)]));
  return {
    ...draft,
    action_items: draft.action_items.filter((a) => a.trim()),
    sections: draft.sections.map((raw) => {
      const sec = tidySection(raw);
      const prev = before.get(sec.section_id);
      const has = sectionHasContent(sec);
      if (prev && sameContent(prev, sec)) {
        return has ? { ...sec, not_discussed: false } : sec;
      }
      return { ...sec, not_discussed: !has, used_defaults: false };
    }),
  };
}
