import type { Section, Template } from '../api/types';

const T0 = '2026-01-05T09:00:00Z';

function sec(p: Partial<Section> & Pick<Section, 'id' | 'title' | 'format'>): Section {
  return { instructions: '', fields: [], required: true, missing_behavior: 'state_not_discussed', normal_defaults: '', ...p };
}

const vitals: Section = sec({
  id: 'objective',
  title: 'Objective',
  format: 'key_value',
  instructions: 'Vitals and measurable exam findings stated in the transcript.',
  fields: [
    { key: 'temperature', label: 'Temperature', hint: 'with unit' },
    { key: 'heart_rate', label: 'Heart rate', hint: 'bpm' },
    { key: 'resp_rate', label: 'Respiratory rate', hint: 'brpm' },
    { key: 'weight', label: 'Weight', hint: 'kg or lb as stated' },
    { key: 'bcs', label: 'BCS', hint: 'x/9' },
    { key: 'mm_crt', label: 'MM / CRT', hint: '' },
  ],
});

const bodySystems: Section = sec({
  id: 'body_systems',
  title: 'Physical exam – body systems',
  format: 'paragraph',
  instructions: 'Findings by body system. Abnormal findings from the transcript always override defaults.',
  missing_behavior: 'use_normal_defaults',
  normal_defaults: 'BAR, MM pink & moist, CRT <2s, heart and lungs auscultate normally, abdomen soft and non-painful, no lymphadenopathy.',
});

export const SEED_TEMPLATES: Template[] = [
  {
    id: 'builtin-soap',
    name: 'SOAP – General Consult',
    description: 'Classic Subjective / Objective / Assessment / Plan note for a general consultation.',
    appointment_type: 'general',
    species: [],
    is_builtin: true,
    sections: [
      sec({ id: 'subjective', title: 'Subjective', format: 'paragraph', instructions: 'History, presenting complaint, owner observations.' }),
      vitals,
      bodySystems,
      sec({ id: 'assessment', title: 'Assessment', format: 'bullets', instructions: 'Diagnoses and differentials, most likely first.' }),
      sec({ id: 'plan', title: 'Plan', format: 'bullets', instructions: 'Treatments, medications with doses as stated, diagnostics, recheck.' }),
    ],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    version: 1,
    created_at: T0,
    updated_at: T0,
  },
  {
    id: 'builtin-wellness',
    name: 'Wellness / Vaccination',
    description: 'Annual preventive-care visit: history, exam, vaccines given, parasite prevention and counselling.',
    appointment_type: 'wellness',
    species: ['canine', 'feline'],
    is_builtin: true,
    sections: [
      sec({ id: 'history', title: 'History', format: 'paragraph', instructions: 'Diet, appetite, thirst, elimination, behaviour, lifestyle.' }),
      vitals,
      bodySystems,
      sec({ id: 'vaccines', title: 'Vaccines & prevention', format: 'bullets', instructions: 'Vaccines given (site), parasite prevention discussed.', missing_behavior: 'omit', required: false }),
      sec({ id: 'assessment_plan', title: 'Assessment & plan', format: 'bullets', instructions: 'Concerns, diagnostics recommended, follow-up.' }),
    ],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    version: 1,
    created_at: T0,
    updated_at: T0,
  },
  {
    id: 'builtin-sick',
    name: 'Sick Visit / Problem-focused',
    description: 'Focused note for an acute problem: presenting complaint, relevant exam, diagnostics, treatment.',
    appointment_type: 'sick',
    species: ['canine', 'feline'],
    is_builtin: true,
    sections: [
      sec({ id: 'presenting_complaint', title: 'Presenting complaint & history', format: 'paragraph', instructions: 'Onset, duration, progression, owner observations.' }),
      vitals,
      sec({ id: 'findings', title: 'Pertinent findings', format: 'bullets', instructions: 'Exam findings relevant to the complaint, diagnostic results.' }),
      sec({ id: 'assessment', title: 'Assessment', format: 'bullets', instructions: 'Diagnoses and differentials.' }),
      sec({ id: 'treatment_plan', title: 'Treatment plan', format: 'bullets', instructions: 'Medications as dosed in the transcript, instructions, recheck.' }),
    ],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    version: 1,
    created_at: T0,
    updated_at: T0,
  },
  {
    id: 'builtin-dental',
    name: 'Dental (COHAT)',
    description: 'Comprehensive oral health assessment: findings, planned procedures, consent, estimate and home care.',
    appointment_type: 'dental',
    species: ['canine', 'feline'],
    is_builtin: true,
    sections: [
      sec({ id: 'history', title: 'History', format: 'paragraph', instructions: 'Owner concerns about mouth, eating, breath, prior dentals.' }),
      vitals,
      sec({ id: 'oral_findings', title: 'Oral findings', format: 'bullets', instructions: 'Calculus, gingivitis, mobility, fractures, staging.' }),
      sec({ id: 'procedure_plan', title: 'Procedure plan', format: 'bullets', instructions: 'Radiographs, scaling, anticipated extractions, anaesthesia notes.' }),
      sec({ id: 'consent_estimate', title: 'Consent & estimate', format: 'paragraph', instructions: 'Consent given, estimate range discussed.', missing_behavior: 'omit', required: false }),
      sec({ id: 'home_care', title: 'Home care', format: 'bullets', instructions: 'Pre/post-procedure instructions and follow-up.' }),
    ],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    version: 1,
    created_at: T0,
    updated_at: T0,
  },
];
