import type { NoteResult, ResultSection } from '../api/types';
import { finalizeResult, sectionHasContent } from './finalizeResult';

const para = (p: Partial<ResultSection> = {}): ResultSection => ({ section_id: 'subjective', title: 'Subjective', format: 'paragraph', content: '', items: [], fields: [], not_discussed: true, used_defaults: false, ...p });
const bullets = (p: Partial<ResultSection> = {}): ResultSection => ({ section_id: 'plan', title: 'Plan', format: 'bullets', content: '', items: [], fields: [], not_discussed: true, used_defaults: false, ...p });
const kv = (p: Partial<ResultSection> = {}): ResultSection => ({
  section_id: 'objective',
  title: 'Objective',
  format: 'key_value',
  content: '',
  items: [],
  fields: [{ key: 'weight', label: 'Weight', value: '' }],
  not_discussed: true,
  used_defaults: false,
  ...p,
});
const result = (sections: ResultSection[], p: Partial<NoteResult> = {}): NoteResult => ({ visit_summary: '', sections, action_items: [], review_flags: [], ...p });
const edit = (r: NoteResult, f: (r: NoteResult) => void): NoteResult => {
  const c = structuredClone(r);
  f(c);
  return c;
};

describe('sectionHasContent', () => {
  it('looks at the format-specific content only', () => {
    expect(sectionHasContent(para({ content: '  ' }))).toBe(false);
    expect(sectionHasContent(para({ content: 'x' }))).toBe(true);
    expect(sectionHasContent(bullets({ items: ['', ' '] }))).toBe(false);
    expect(sectionHasContent(bullets({ items: ['a'] }))).toBe(true);
    expect(sectionHasContent(kv())).toBe(false);
    expect(sectionHasContent(kv({ fields: [{ key: 'weight', label: 'Weight', value: '3 kg' }] }))).toBe(true);
  });
});

describe('finalizeResult', () => {
  const blank = result([para(), bullets(), kv()]);

  it('marks every section with new content as discussed, for all three formats', () => {
    const draft = edit(blank, (r) => {
      r.sections[0].content = 'Limping';
      r.sections[1].items = ['Rest'];
      r.sections[2].fields[0].value = '30 kg';
    });
    const out = finalizeResult(blank, draft);
    expect(out.sections.map((s) => s.not_discussed)).toEqual([false, false, false]);
  });

  it('marks a section the vet emptied as not discussed and clears used_defaults', () => {
    const before = result([para({ content: 'Normal heart.', not_discussed: false, used_defaults: true })]);
    const out = finalizeResult(before, edit(before, (r) => (r.sections[0].content = '  ')));
    expect(out.sections[0]).toMatchObject({ not_discussed: true, used_defaults: false });
  });

  it('keeps used_defaults when the section content is untouched', () => {
    const before = result([para({ content: 'Normal heart.', not_discussed: false, used_defaults: true }), para({ section_id: 'x', content: 'Old', not_discussed: false })]);
    const out = finalizeResult(before, edit(before, (r) => (r.sections[1].content = 'New')));
    expect(out.sections[0]).toMatchObject({ used_defaults: true, not_discussed: false });
    expect(out.sections[1]).toMatchObject({ used_defaults: false, not_discussed: false });
  });

  it('clears used_defaults once the vet edits that section', () => {
    const before = result([bullets({ items: ['Normal findings'], not_discussed: false, used_defaults: true })]);
    const out = finalizeResult(before, edit(before, (r) => (r.sections[0].items = ['Normal findings', 'Mild tartar'])));
    expect(out.sections[0].used_defaults).toBe(false);
  });

  it('leaves an untouched empty section as it was', () => {
    const out = finalizeResult(blank, structuredClone(blank));
    expect(out.sections).toEqual(blank.sections);
  });

  it('ignores blank bullets and follow-ups, and does not count them as an edit', () => {
    const before = result([bullets({ items: ['a'], not_discussed: false, used_defaults: true })]);
    const out = finalizeResult(before, edit(before, (r) => {
      r.sections[0].items = ['a', ''];
      r.action_items = ['Recheck', ' '];
    }));
    expect(out.sections[0]).toMatchObject({ items: ['a'], used_defaults: true });
    expect(out.action_items).toEqual(['Recheck']);
  });

  it('keeps the visit summary and review flags the vet entered', () => {
    const out = finalizeResult(blank, edit(blank, (r) => {
      r.visit_summary = 'Limp, rest advised';
      r.review_flags = ['Check dose'];
    }));
    expect(out).toMatchObject({ visit_summary: 'Limp, rest advised', review_flags: ['Check dose'] });
  });
});
