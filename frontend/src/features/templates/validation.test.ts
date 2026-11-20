import type { Section, TemplateInput } from '../../api/types';
import { ID_REGEX, sectionErrorCount, toTemplateInput, validateId, validateTemplate } from './validation';
import { slugify } from '../../lib/format';

function section(p: Partial<Section> = {}): Section {
  return { id: 'subjective', title: 'Subjective', instructions: '', format: 'paragraph', fields: [], required: true, missing_behavior: 'omit', normal_defaults: '', ...p };
}
function tpl(p: Partial<TemplateInput> = {}): TemplateInput {
  return {
    name: 'My template',
    description: '',
    appointment_type: 'general',
    species: [],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    sections: [section()],
    ...p,
  };
}

describe('validateId', () => {
  it.each(['a', 'subjective', 'body_systems', 'x1_2', 'a'.repeat(40)])('accepts %s', (id) => {
    expect(validateId(id)).toBeUndefined();
    expect(ID_REGEX.test(id)).toBe(true);
  });
  it.each(['', '1abc', 'Abc', 'has space', 'dash-ed', '_x', 'a'.repeat(41)])('rejects %j', (id) => {
    expect(validateId(id)).toBeTruthy();
  });
});

describe('validateTemplate', () => {
  it('accepts a minimal valid template', () => {
    expect(validateTemplate(tpl())).toEqual({ valid: true, errors: {} });
  });

  it('requires a name of 1..120 chars', () => {
    expect(validateTemplate(tpl({ name: '   ' })).errors.name).toBeTruthy();
    expect(validateTemplate(tpl({ name: 'x'.repeat(121) })).errors.name).toBeTruthy();
    expect(validateTemplate(tpl({ name: 'x'.repeat(120) })).valid).toBe(true);
  });

  it('limits description and custom instructions', () => {
    expect(validateTemplate(tpl({ description: 'x'.repeat(501) })).errors.description).toBeTruthy();
    const t = tpl();
    t.style.custom_instructions = 'x'.repeat(2001);
    expect(validateTemplate(t).errors.custom_instructions).toBeTruthy();
  });

  it('needs 1..30 sections', () => {
    expect(validateTemplate(tpl({ sections: [] })).errors.sections).toBeTruthy();
    const many = Array.from({ length: 31 }, (_, i) => section({ id: `s${i}`, title: `S${i}` }));
    expect(validateTemplate(tpl({ sections: many })).errors.sections).toBeTruthy();
    expect(validateTemplate(tpl({ sections: many.slice(0, 30) })).valid).toBe(true);
  });

  it('flags invalid and duplicate section ids', () => {
    const r = validateTemplate(tpl({ sections: [section({ id: 'Bad Id' }), section({ id: 'dup' }), section({ id: 'dup', title: 'Other' })] }));
    expect(r.valid).toBe(false);
    expect(r.errors['sections.0.id']).toBeTruthy();
    expect(r.errors['sections.1.id']).toBeUndefined();
    expect(r.errors['sections.2.id']).toMatch(/duplicate/i);
  });

  it('requires a title up to 80 chars and instructions up to 2000', () => {
    const r = validateTemplate(tpl({ sections: [section({ title: ' ' }), section({ id: 'b', title: 'x'.repeat(81) }), section({ id: 'c', instructions: 'x'.repeat(2001) })] }));
    expect(r.errors['sections.0.title']).toBeTruthy();
    expect(r.errors['sections.1.title']).toBeTruthy();
    expect(r.errors['sections.2.instructions']).toBeTruthy();
  });

  it('requires at least one field for key_value sections', () => {
    const r = validateTemplate(tpl({ sections: [section({ format: 'key_value', fields: [] })] }));
    expect(r.errors['sections.0.fields']).toBeTruthy();
  });

  it('does not require fields for paragraph/bullets', () => {
    expect(validateTemplate(tpl({ sections: [section({ format: 'bullets' })] })).valid).toBe(true);
  });

  it('validates field keys (regex + unique) and labels', () => {
    const r = validateTemplate(
      tpl({
        sections: [
          section({
            format: 'key_value',
            fields: [
              { key: 'weight', label: 'Weight', hint: '' },
              { key: 'weight', label: 'Weight 2', hint: '' },
              { key: 'Bad-Key', label: 'x', hint: '' },
              { key: 'ok', label: '', hint: '' },
            ],
          }),
        ],
      }),
    );
    expect(r.errors['sections.0.fields.0.key']).toBeUndefined();
    expect(r.errors['sections.0.fields.1.key']).toMatch(/duplicate/i);
    expect(r.errors['sections.0.fields.2.key']).toBeTruthy();
    expect(r.errors['sections.0.fields.3.label']).toBeTruthy();
  });

  it('counts errors per section', () => {
    const r = validateTemplate(tpl({ sections: [section(), section({ id: 'x', title: '' })] }));
    expect(sectionErrorCount(r.errors, 0)).toBe(0);
    expect(sectionErrorCount(r.errors, 1)).toBe(1);
  });
});

describe('toTemplateInput', () => {
  it('strips fields from non key_value sections and defaults when unused', () => {
    const out = toTemplateInput(
      tpl({
        name: '  Padded  ',
        sections: [
          section({ format: 'paragraph', fields: [{ key: 'k', label: 'K', hint: '' }], normal_defaults: 'stale', missing_behavior: 'omit' }),
          section({ id: 'b', format: 'paragraph', missing_behavior: 'use_normal_defaults', normal_defaults: ' BAR ' }),
        ],
      }),
    );
    expect(out.name).toBe('Padded');
    expect(out.sections[0].fields).toEqual([]);
    expect(out.sections[0].normal_defaults).toBe('');
    expect(out.sections[1].normal_defaults).toBe('BAR');
  });
});

describe('slugify', () => {
  it('produces ids matching the id regex', () => {
    expect(slugify('Physical Exam – Body Systems')).toBe('physical_exam_body_systems');
    expect(slugify('3 Month Plan')).toBe('s_3_month_plan');
    expect(slugify('Étude')).toBe('etude');
    expect(slugify('!!!')).toBe('');
    expect(ID_REGEX.test(slugify('x'.repeat(80)))).toBe(true);
  });
});
