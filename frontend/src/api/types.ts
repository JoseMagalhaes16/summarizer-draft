// Mirrors docs/design/spec.md section 4 (wire format is snake_case).

export const APPOINTMENT_TYPES = [
  'general',
  'wellness',
  'sick',
  'recheck',
  'dental',
  'surgery',
  'euthanasia',
  'emergency',
  'phone',
  'other',
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const SPECIES = ['canine', 'feline', 'equine', 'bovine', 'exotic', 'avian', 'other'] as const;
export type Species = (typeof SPECIES)[number];

export type SectionFormat = 'paragraph' | 'bullets' | 'key_value';
export type MissingBehavior = 'omit' | 'state_not_discussed' | 'use_normal_defaults';
export type Tone = 'clinical' | 'client_friendly';

export interface FieldDef {
  key: string;
  label: string;
  hint: string;
}

export interface Section {
  id: string;
  title: string;
  instructions: string;
  format: SectionFormat;
  fields: FieldDef[];
  required: boolean;
  missing_behavior: MissingBehavior;
  normal_defaults: string;
}

export interface TemplateStyle {
  tone: Tone;
  use_abbreviations: boolean;
  custom_instructions: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  appointment_type: AppointmentType;
  species: Species[];
  is_builtin: boolean;
  sections: Section[];
  style: TemplateStyle;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Template without id, is_builtin, version, timestamps. */
export type TemplateInput = Omit<Template, 'id' | 'is_builtin' | 'version' | 'created_at' | 'updated_at'>;

export interface Patient {
  name?: string;
  species?: string;
  breed?: string;
  age?: string;
  sex?: string;
  weight?: string;
}

export type NoteStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type NoteErrorCode =
  | 'MODEL_REFUSAL'
  | 'OUTPUT_TRUNCATED'
  | 'INVALID_MODEL_OUTPUT'
  | 'LLM_ERROR'
  | 'GENERATION_TIMEOUT'
  | 'INTERNAL';

export interface NoteError {
  code: NoteErrorCode | string;
  message: string;
}

export interface ResultField {
  key: string;
  label: string;
  value: string;
}

export interface ResultSection {
  section_id: string;
  title: string;
  format: SectionFormat;
  content: string;
  items: string[];
  fields: ResultField[];
  not_discussed: boolean;
  used_defaults: boolean;
}

export interface NoteResult {
  visit_summary: string;
  sections: ResultSection[];
  action_items: string[];
  review_flags: string[];
}

export interface ModelInfo {
  provider: 'bedrock' | 'mock' | string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export interface Note {
  id: string;
  template_id: string;
  template_name: string;
  template_snapshot: Template;
  patient: Patient;
  clinician: string;
  transcript: string;
  status: NoteStatus;
  /** Identifies the current generation attempt; the UI doesn't display it. */
  generation_id: string | null;
  error: NoteError | null;
  result: NoteResult | null;
  edited: boolean;
  model_info: ModelInfo | null;
  created_at: string;
  updated_at: string;
  /** Only present on GET /v1/notes/{id} when completed. */
  rendered_markdown?: string;
  rendered_text?: string;
}

export interface NoteSummary {
  id: string;
  template_id: string;
  template_name: string;
  patient: Patient;
  status: NoteStatus;
  visit_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNoteInput {
  template_id: string;
  transcript: string;
  patient?: Patient;
  clinician?: string;
}

export interface Health {
  status: string;
  llm_provider: string;
  storage: string;
}

export const MAX_TRANSCRIPT_CHARS = 200_000;
/** The server also caps the UTF-8 size of the transcript. */
export const MAX_TRANSCRIPT_BYTES = 300_000;
