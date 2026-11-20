import type { Section, TemplateInput } from '../../api/types';

/** Mirrors docs/design/spec.md section 4 (template + section rules). */
export const LIMITS = {
  nameMax: 120,
  descriptionMax: 500,
  sectionsMin: 1,
  sectionsMax: 30,
  customInstructionsMax: 2000,
  titleMax: 80,
  instructionsMax: 2000,
  fieldLabelMax: 80,
  fieldHintMax: 200,
} as const;

export const ID_REGEX = /^[a-z][a-z0-9_]{0,39}$/;

export type ValidationErrors = Record<string, string>;

export interface TemplateValidation {
  valid: boolean;
  /** Flat map keyed by path, e.g. `name`, `sections`, `sections.2.id`, `sections.2.fields.0.key`. */
  errors: ValidationErrors;
}

export const sectionPath = (i: number, rest: string) => `sections.${i}.${rest}`;
export const fieldPath = (i: number, j: number, rest: string) => `sections.${i}.fields.${j}.${rest}`;

export function validateId(id: string): string | undefined {
  if (!id) return 'Required.';
  if (!ID_REGEX.test(id)) return 'Use lowercase letters, digits and underscores; start with a letter (max 40).';
  return undefined;
}

export function validateSection(section: Section, index: number, seenIds: Map<string, number>, errors: ValidationErrors): void {
  const idErr = validateId(section.id);
  if (idErr) errors[sectionPath(index, 'id')] = idErr;
  else if (seenIds.has(section.id)) errors[sectionPath(index, 'id')] = `Duplicate id (also used by section ${(seenIds.get(section.id) ?? 0) + 1}).`;
  else seenIds.set(section.id, index);

  const title = section.title.trim();
  if (!title) errors[sectionPath(index, 'title')] = 'Title is required.';
  else if (title.length > LIMITS.titleMax) errors[sectionPath(index, 'title')] = `Max ${LIMITS.titleMax} characters.`;

  if (section.instructions.length > LIMITS.instructionsMax) errors[sectionPath(index, 'instructions')] = `Max ${LIMITS.instructionsMax} characters.`;

  if (section.format === 'key_value') {
    if (section.fields.length < 1) {
      errors[sectionPath(index, 'fields')] = 'Add at least one field.';
    }
    const seenKeys = new Map<string, number>();
    section.fields.forEach((f, j) => {
      const keyErr = validateId(f.key);
      if (keyErr) errors[fieldPath(index, j, 'key')] = keyErr;
      else if (seenKeys.has(f.key)) errors[fieldPath(index, j, 'key')] = 'Duplicate key.';
      else seenKeys.set(f.key, j);
      if (!f.label.trim()) errors[fieldPath(index, j, 'label')] = 'Label is required.';
      else if (f.label.length > LIMITS.fieldLabelMax) errors[fieldPath(index, j, 'label')] = `Max ${LIMITS.fieldLabelMax} characters.`;
      if (f.hint.length > LIMITS.fieldHintMax) errors[fieldPath(index, j, 'hint')] = `Max ${LIMITS.fieldHintMax} characters.`;
    });
  }
}

export function validateTemplate(t: TemplateInput): TemplateValidation {
  const errors: ValidationErrors = {};

  const name = t.name.trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > LIMITS.nameMax) errors.name = `Max ${LIMITS.nameMax} characters.`;

  if (t.description.length > LIMITS.descriptionMax) errors.description = `Max ${LIMITS.descriptionMax} characters.`;
  if (t.style.custom_instructions.length > LIMITS.customInstructionsMax) {
    errors.custom_instructions = `Max ${LIMITS.customInstructionsMax} characters.`;
  }

  if (t.sections.length < LIMITS.sectionsMin) errors.sections = 'Add at least one section.';
  else if (t.sections.length > LIMITS.sectionsMax) errors.sections = `At most ${LIMITS.sectionsMax} sections.`;

  const seenIds = new Map<string, number>();
  t.sections.forEach((s, i) => validateSection(s, i, seenIds, errors));

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Number of errors that belong to section `i`. */
export function sectionErrorCount(errors: ValidationErrors, i: number): number {
  const prefix = `sections.${i}.`;
  return Object.keys(errors).filter((k) => k.startsWith(prefix)).length;
}

/** Normalise before sending: trim text, drop fields from non key_value sections, defaults only when used. */
export function toTemplateInput(t: TemplateInput): TemplateInput {
  return {
    ...t,
    name: t.name.trim(),
    description: t.description.trim(),
    style: { ...t.style, custom_instructions: t.style.custom_instructions.trim() },
    sections: t.sections.map((s) => ({
      ...s,
      title: s.title.trim(),
      instructions: s.instructions.trim(),
      fields: s.format === 'key_value' ? s.fields.map((f) => ({ key: f.key, label: f.label.trim(), hint: f.hint.trim() })) : [],
      normal_defaults: s.missing_behavior === 'use_normal_defaults' ? s.normal_defaults.trim() : '',
    })),
  };
}
