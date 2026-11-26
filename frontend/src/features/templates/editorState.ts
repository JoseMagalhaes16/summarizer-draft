import type { AppointmentType, FieldDef, Section, Species, Template, TemplateInput } from '../../api/types';
import { slugify } from '../../lib/format';

export interface EditorField extends FieldDef {
  uid: string;
  keyEdited: boolean;
}
export interface EditorSection extends Omit<Section, 'fields'> {
  uid: string;
  idEdited: boolean;
  fields: EditorField[];
  open: boolean;
}
export interface EditorState {
  name: string;
  description: string;
  appointment_type: AppointmentType;
  species: Species[];
  style: TemplateInput['style'];
  sections: EditorSection[];
}

let counter = 0;
export const newUid = () => `u${++counter}`;

export function blankSection(existingIds: string[]): EditorSection {
  return {
    uid: newUid(),
    idEdited: false,
    open: true,
    id: uniqueId('section', existingIds),
    title: '',
    instructions: '',
    format: 'paragraph',
    fields: [],
    required: false,
    missing_behavior: 'state_not_discussed',
    normal_defaults: '',
  };
}

export function blankField(existingKeys: string[]): EditorField {
  return { uid: newUid(), keyEdited: false, key: uniqueId('field', existingKeys), label: '', hint: '' };
}

export function blankState(): EditorState {
  const first = blankSection([]);
  first.title = 'Notes';
  first.id = 'notes';
  return {
    name: '',
    description: '',
    appointment_type: 'general',
    species: [],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    sections: [first],
  };
}

export function stateFromTemplate(t: Template | TemplateInput, collapse = true): EditorState {
  return {
    name: t.name,
    description: t.description,
    appointment_type: t.appointment_type,
    species: [...t.species],
    style: { ...t.style },
    sections: t.sections.map((s) => ({
      ...s,
      uid: newUid(),
      idEdited: true,
      open: !collapse,
      fields: s.fields.map((f) => ({ ...f, uid: newUid(), keyEdited: true })),
    })),
  };
}

export function stateToInput(s: EditorState): TemplateInput {
  return {
    name: s.name,
    description: s.description,
    appointment_type: s.appointment_type,
    species: s.species,
    style: s.style,
    sections: s.sections.map(({ uid: _u, idEdited: _i, open: _o, fields, ...rest }) => ({
      ...rest,
      fields: fields.map(({ key, label, hint }) => ({ key, label, hint })),
    })),
  };
}

/** Pick `base`, `base_2`, `base_3`... not in `taken`, respecting the 40-char id limit. */
export function uniqueId(base: string, taken: string[]): string {
  const root = base || 'section';
  if (!taken.includes(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = root.slice(0, 40 - suffix.length) + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function slugFor(title: string, fallback: string, taken: string[]): string {
  return uniqueId(slugify(title) || fallback, taken);
}
