import type { Note, NoteResult, NoteSummary, Patient, ResultSection, Section, Template, TemplateInput } from '../api/types';
import { MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPT_CHARS } from '../api/types';
import { SEED_TEMPLATES } from './seed';

/**
 * In-memory implementation of the VetScribe HTTP API (spec section 5), used by
 * `npm run dev:mock`. Framework-agnostic: handlers.ts adapts it to msw.
 */

export class MockApiError extends Error {
  status: number;
  code: string;
  details?: unknown[];
  constructor(status: number, code: string, message: string, details?: unknown[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)];
  return time + rand;
}

const iso = () => new Date().toISOString();

interface StoredNote extends Note {
  _ready_at: number;
  _processing_at: number;
  _fail: boolean;
  /** Mock: generation never finishes (simulates the worker dying). */
  _timeout: boolean;
}

export interface MockOptions {
  /** ms until a note leaves "pending" */
  processingDelayMs?: number;
  /** ms until a note is completed */
  completeDelayMs?: number;
  seedNotes?: boolean;
  /** Demo switch: behave like LLM_PROVIDER=none (AI drafting switched off). */
  aiOff?: boolean;
}

export class MockEngine {
  templates = new Map<string, Template>();
  notes = new Map<string, StoredNote>();
  readonly opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = { processingDelayMs: 900, completeDelayMs: 3200, seedNotes: true, aiOff: false, ...opts };
    this.reset();
  }

  reset() {
    this.templates = new Map(SEED_TEMPLATES.map((t) => [t.id, structuredClone(t)]));
    this.notes = new Map();
    if (this.opts.seedNotes) this.seedNotes();
  }

  // ------------------------------------------------------------- templates
  health() {
    return { status: 'ok', llm_provider: this.opts.aiOff ? 'none' : 'mock', storage: 'memory', ai_enabled: !this.opts.aiOff };
  }

  listTemplates(): { items: Template[] } {
    const all = [...this.templates.values()];
    const builtin = all.filter((t) => t.is_builtin);
    const custom = all.filter((t) => !t.is_builtin).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { items: [...builtin, ...custom] };
  }

  getTemplate(id: string): Template {
    const t = this.templates.get(id);
    if (!t) throw new MockApiError(404, 'NOT_FOUND', `Template ${id} not found`);
    return t;
  }

  createTemplate(body: unknown): Template {
    const input = validateTemplateInput(body);
    const now = iso();
    const t: Template = { ...input, id: crypto.randomUUID(), is_builtin: false, version: 1, created_at: now, updated_at: now };
    this.templates.set(t.id, t);
    return t;
  }

  updateTemplate(id: string, body: unknown): Template {
    const existing = this.getTemplate(id);
    if (existing.is_builtin) throw new MockApiError(403, 'READ_ONLY', 'Built-in templates cannot be modified. Duplicate it instead.');
    const input = validateTemplateInput(body);
    const t: Template = { ...existing, ...input, version: existing.version + 1, updated_at: iso() };
    this.templates.set(id, t);
    return t;
  }

  deleteTemplate(id: string): void {
    const existing = this.getTemplate(id);
    if (existing.is_builtin) throw new MockApiError(403, 'READ_ONLY', 'Built-in templates cannot be deleted.');
    this.templates.delete(id);
  }

  duplicateTemplate(id: string, body: unknown): Template {
    const src = this.getTemplate(id);
    const name = (body as { name?: string } | null)?.name?.trim() || `${src.name} (copy)`;
    const now = iso();
    const t: Template = { ...structuredClone(src), id: crypto.randomUUID(), name, is_builtin: false, version: 1, created_at: now, updated_at: now };
    this.templates.set(t.id, t);
    return t;
  }

  // ----------------------------------------------------------------- notes
  private requireAi() {
    if (this.opts.aiOff) throw new MockApiError(409, 'AI_DISABLED', 'AI drafting is switched off in this environment. Write the note manually.');
  }

  createManualNote(body: unknown): Note {
    const b = (body ?? {}) as { template_id?: string; transcript?: string; patient?: Patient; clinician?: string; result?: NoteResult; prefill_defaults?: boolean };
    const details: { field: string; message: string }[] = [];
    if (typeof b.transcript === 'string' && new TextEncoder().encode(b.transcript).length > MAX_TRANSCRIPT_BYTES) {
      throw new MockApiError(413, 'PAYLOAD_TOO_LARGE', `Transcript is too large. The limit is ${MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters (${MAX_TRANSCRIPT_BYTES.toLocaleString('en-US')} bytes).`);
    }
    if (!b.template_id) details.push({ field: 'template_id', message: 'Required' });
    if (b.transcript !== undefined && typeof b.transcript !== 'string') details.push({ field: 'transcript', message: 'Must be text' });
    else if ((b.transcript ?? '').length > MAX_TRANSCRIPT_CHARS) details.push({ field: 'transcript', message: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters` });
    if (details.length) throw new MockApiError(400, 'VALIDATION_ERROR', 'Invalid request body', details);
    const tpl = this.getTemplate(b.template_id as string);
    if (b.result) {
      const bad = checkResultShape(tpl, b.result);
      if (bad.length) throw new MockApiError(400, 'VALIDATION_ERROR', 'Invalid result', bad);
    }
    const result = b.result ?? blankResult(tpl, b.prefill_defaults === true);
    const now = iso();
    const n: StoredNote = {
      id: ulid(),
      template_id: tpl.id,
      template_name: tpl.name,
      template_snapshot: structuredClone(tpl),
      patient: b.patient ?? {},
      clinician: b.clinician ?? '',
      transcript: b.transcript ?? '',
      status: 'completed',
      generation_id: ulid(),
      error: null,
      result: structuredClone(result),
      source: 'manual',
      edited: false,
      model_info: null,
      created_at: now,
      updated_at: now,
      _processing_at: 0,
      _ready_at: 0,
      _fail: false,
      _timeout: false,
    };
    this.notes.set(n.id, n);
    return this.publicNote(n);
  }

  createNote(body: unknown): Note {
    this.requireAi();
    const b = (body ?? {}) as { template_id?: string; transcript?: string; patient?: Patient; clinician?: string };
    const details: unknown[] = [];
    if (typeof b.transcript === 'string' && new TextEncoder().encode(b.transcript).length > MAX_TRANSCRIPT_BYTES) {
      throw new MockApiError(413, 'PAYLOAD_TOO_LARGE', `Transcript is too large. The limit is ${MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters (${MAX_TRANSCRIPT_BYTES.toLocaleString('en-US')} bytes).`);
    }
    if (!b.template_id) details.push({ field: 'template_id', message: 'Required' });
    if (typeof b.transcript !== 'string' || !b.transcript.trim()) details.push({ field: 'transcript', message: 'Transcript must not be blank' });
    else if (b.transcript.length > MAX_TRANSCRIPT_CHARS) details.push({ field: 'transcript', message: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} characters` });
    if (details.length) throw new MockApiError(400, 'VALIDATION_ERROR', 'Invalid request body', details);
    const tpl = this.getTemplate(b.template_id as string);
    return this.publicNote(this.startNote(tpl, b.transcript as string, b.patient ?? {}, b.clinician ?? ''));
  }

  listNotes(limit = 50): { items: NoteSummary[] } {
    const items = [...this.notes.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((raw) => {
        const n = this.refresh(raw);
        return {
          id: n.id,
          template_id: n.template_id,
          template_name: n.template_name,
          patient: n.patient,
          status: n.status,
          source: n.source,
          visit_summary: n.result?.visit_summary ?? null,
          created_at: n.created_at,
          updated_at: n.updated_at,
        };
      });
    return { items };
  }

  getNote(id: string): Note {
    return this.publicNote(this.refresh(this.mustNote(id)));
  }

  patchNote(id: string, body: unknown): Note {
    const n = this.refresh(this.mustNote(id));
    const result = (body as { result?: NoteResult } | null)?.result;
    if (!result || typeof result.visit_summary !== 'string' || !Array.isArray(result.sections) || !Array.isArray(result.action_items) || !Array.isArray(result.review_flags)) {
      throw new MockApiError(400, 'VALIDATION_ERROR', 'Invalid result', [{ field: 'result', message: 'Malformed NoteResult' }]);
    }
    if (n.status === 'pending' || n.status === 'processing') throw new MockApiError(409, 'GENERATION_IN_PROGRESS', 'This note is still being drafted. Wait for it to finish before editing.');
    if (n.status !== 'completed') throw new MockApiError(409, 'NOT_COMPLETED', 'Only completed notes can be edited.');
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_TRANSCRIPT_BYTES) {
      throw new MockApiError(413, 'PAYLOAD_TOO_LARGE', `The edited note is too large. The limit is ${MAX_TRANSCRIPT_BYTES.toLocaleString('en-US')} bytes.`);
    }
    n.result = result;
    n.edited = true;
    n.updated_at = iso();
    return this.publicNote(n);
  }

  regenerateNote(id: string, body: unknown): Note {
    this.requireAi();
    const n = this.refresh(this.mustNote(id));
    if (n.source === 'manual') throw new MockApiError(409, 'MANUAL_NOTE', 'This note was written manually, so there is nothing to regenerate. Draft another note from a transcript instead.');
    if (n.status === 'pending' || n.status === 'processing') {
      throw new MockApiError(409, 'GENERATION_IN_PROGRESS', 'This note is still being drafted. Wait for it to finish, then regenerate.');
    }
    const tid = (body as { template_id?: string } | null)?.template_id;
    const tpl = tid ? this.getTemplate(tid) : this.templates.get(n.template_id) ?? n.template_snapshot;
    const now = Date.now();
    Object.assign(n, {
      template_id: tpl.id,
      template_name: tpl.name,
      template_snapshot: structuredClone(tpl),
      status: 'pending',
      generation_id: ulid(),
      error: null,
      result: null,
      edited: false,
      model_info: null,
      updated_at: iso(),
      _processing_at: now + this.opts.processingDelayMs,
      _ready_at: now + this.opts.completeDelayMs,
      _fail: false,
      _timeout: false,
    });
    return this.publicNote(n);
  }

  deleteNote(id: string): void {
    this.mustNote(id);
    this.notes.delete(id);
  }

  // --------------------------------------------------------------- helpers
  private mustNote(id: string): StoredNote {
    const n = this.notes.get(id);
    if (!n) throw new MockApiError(404, 'NOT_FOUND', `Note ${id} not found`);
    return n;
  }

  private startNote(tpl: Template, transcript: string, patient: Patient, clinician: string, created = Date.now()): StoredNote {
    const now = new Date(created).toISOString();
    const n: StoredNote = {
      id: ulid(),
      template_id: tpl.id,
      template_name: tpl.name,
      template_snapshot: structuredClone(tpl),
      patient,
      clinician,
      transcript,
      status: 'pending',
      generation_id: ulid(),
      error: null,
      result: null,
      source: 'ai',
      edited: false,
      model_info: null,
      created_at: now,
      updated_at: now,
      _processing_at: created + this.opts.processingDelayMs,
      _ready_at: created + this.opts.completeDelayMs,
      _fail: /\bfail me\b/i.test(transcript),
      _timeout: /\btime me out\b/i.test(transcript),
    };
    this.notes.set(n.id, n);
    return n;
  }

  /** Advance pending -> processing -> completed/failed based on the clock. */
  private refresh(n: StoredNote): StoredNote {
    if (n.status === 'completed' || n.status === 'failed') return n;
    const now = Date.now();
    if (now >= n._ready_at) {
      if (n._timeout) {
        n.status = 'failed';
        n.error = { code: 'GENERATION_TIMEOUT', message: 'Generation did not finish in time.' };
      } else if (n._fail) {
        n.status = 'failed';
        n.error = { code: 'LLM_ERROR', message: 'The model service is temporarily unavailable. Please try again.' };
      } else {
        n.status = 'completed';
        n.result = generate(n.template_snapshot, n.transcript);
        n.model_info = { provider: 'mock', model_id: 'mock-scribe-1', input_tokens: Math.round(n.transcript.length / 4), output_tokens: 640, latency_ms: this.opts.completeDelayMs };
      }
      n.updated_at = iso();
    } else if (now >= n._processing_at && n.status === 'pending') {
      n.status = 'processing';
    }
    return n;
  }

  private publicNote(n: StoredNote): Note {
    const { _ready_at: _r, _processing_at: _p, _fail: _f, _timeout: _t, ...note } = n;
    if (note.status === 'completed' && note.result) {
      note.rendered_text = renderText(note.result, note.template_snapshot);
      note.rendered_markdown = renderMarkdown(note.result, note.template_snapshot);
    }
    return structuredClone(note);
  }

  private seedNotes() {
    const hour = 3600_000;
    const mk = (tplId: string, patient: Patient, transcript: string, agoMs: number, summary: string) => {
      const tpl = this.templates.get(tplId)!;
      const n = this.startNote(tpl, transcript, patient, 'Dr. Patel', Date.now() - agoMs);
      n._processing_at = n._ready_at = 0;
      this.refresh(n);
      if (n.result) n.result.visit_summary = summary;
      return n;
    };
    mk(
      'builtin-sick',
      { name: 'Biscuit', species: 'canine', breed: 'Labrador Retriever', age: '6 years', sex: 'Male, neutered', weight: '34.2 kg' },
      'Vet: What has been going on? Owner: He has been shaking his head and scratching his left ear for three weeks. It smells yeasty. Vet: Temperature is 101.6 F, heart rate 96, weight 34.2 kg. Cytology shows Malassezia and rods. Vet: Bilateral otitis externa. Start ear ointment twice daily for fourteen days and recheck in two weeks.',
      2 * hour,
      'Labrador with three weeks of head shaking; bilateral otitis externa (yeast and bacterial) treated with ear ointment, recheck in 2 weeks.',
    );
    mk(
      'builtin-wellness',
      { name: 'Mochi', species: 'feline', breed: 'Domestic Shorthair', age: '11 years', sex: 'Female, spayed', weight: '3.9 kg' },
      'Vet: Annual exam for Mochi. Owner: She is eating more but looks thinner and drinks a lot. Vet: Weight 3.9 kg, down from 4.8 kg. Heart rate 220 with a soft murmur. Thyroid nodule palpable. Recommend bloodwork with total T4, urinalysis and blood pressure. Rabies vaccine given today.',
      30 * hour,
      '11-year-old cat with 19% weight loss, polyphagia and polydipsia; suspect hyperthyroidism, bloodwork recommended, rabies vaccine given.',
    );
    const pending = this.startNote(this.templates.get('builtin-dental')!, 'Vet: Pepper is here for a dental consult. Owner: Her breath is terrible and she drops her kibble.', { name: 'Pepper', species: 'canine' }, 'Dr. Patel', Date.now() - 2 * 24 * hour);
    pending._processing_at = pending._ready_at = 0;
    this.refresh(pending);
    if (pending.result) pending.result.visit_summary = '9-year-old Schnauzer with stage 3 periodontal disease; COHAT with probable extractions planned for next Tuesday.';
    const manual = this.createManualNote({
      template_id: 'builtin-soap',
      patient: { name: 'Juniper', species: 'canine', breed: 'Border Collie', age: '3 years', sex: 'Female, spayed' },
      clinician: 'Dr. Patel',
    });
    const mn = this.notes.get(manual.id)!;
    mn.created_at = new Date(Date.now() - 5 * hour).toISOString();
    mn.updated_at = mn.created_at;
    if (mn.result) {
      mn.result.visit_summary = 'Border Collie seen for a limp on the right hind leg, written up by hand.';
      const first = mn.result.sections.find((x) => x.format === 'paragraph');
      if (first) {
        first.content = 'Owner reports a mild limp on the right hind leg since a long walk on Sunday.';
        first.not_discussed = false;
      }
      mn.result.action_items = ['Rest for five days, then recheck'];
      mn.edited = true;
    }
    const failed = this.startNote(this.templates.get('builtin-soap')!, 'fail me', { name: 'Rex', species: 'canine' }, '', Date.now() - 4 * 24 * hour);
    failed._processing_at = failed._ready_at = 0;
    this.refresh(failed);
  }
}

// ------------------------------------------------------------ manual notes

/** Every section empty and not discussed; optionally pre-filled with the template's normal defaults. */
export function blankResult(tpl: Template, prefillDefaults: boolean): NoteResult {
  return {
    visit_summary: '',
    action_items: [],
    review_flags: [],
    sections: tpl.sections.map((s) => {
      const base: ResultSection = {
        section_id: s.id,
        title: s.title,
        format: s.format,
        content: '',
        items: [],
        fields: s.format === 'key_value' ? s.fields.map((f) => ({ key: f.key, label: f.label, value: '' })) : [],
        not_discussed: true,
        used_defaults: false,
      };
      if (prefillDefaults && s.missing_behavior === 'use_normal_defaults' && s.normal_defaults.trim() && s.format !== 'key_value') {
        if (s.format === 'paragraph') base.content = s.normal_defaults;
        else base.items = [s.normal_defaults];
        base.not_discussed = false;
        base.used_defaults = true;
      }
      return base;
    }),
  };
}

function checkResultShape(tpl: Template, r: NoteResult): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (typeof r.visit_summary !== 'string' || !Array.isArray(r.sections) || !Array.isArray(r.action_items) || !Array.isArray(r.review_flags)) {
    return [{ field: 'result', message: 'Malformed NoteResult' }];
  }
  if (r.sections.length !== tpl.sections.length) out.push({ field: 'result.sections', message: 'Sections must match the template' });
  tpl.sections.forEach((s, i) => {
    const got = r.sections[i];
    if (!got || got.section_id !== s.id) out.push({ field: `result.sections.${i}.section_id`, message: `Expected ${s.id}` });
    else if (got.format !== s.format) out.push({ field: `result.sections.${i}.format`, message: `Expected ${s.format}` });
    else if (s.format === 'key_value' && [...(got.fields ?? []).map((f) => f.key)].sort().join() !== s.fields.map((f) => f.key).sort().join()) {
      out.push({ field: `result.sections.${i}.fields`, message: 'Fields must match the template' });
    }
  });
  if (r.visit_summary.length > 500) out.push({ field: 'result.visit_summary', message: 'At most 500 characters' });
  return out;
}

// ---------------------------------------------------------------- validation

function validateTemplateInput(body: unknown): TemplateInput {
  const t = (body ?? {}) as Partial<TemplateInput>;
  const details: { field: string; message: string }[] = [];
  const add = (field: string, message: string) => details.push({ field, message });

  if (typeof t.name !== 'string' || t.name.trim().length < 1 || t.name.length > 120) add('name', 'Name must be 1..120 characters');
  if (typeof t.description !== 'string' || t.description.length > 500) add('description', 'Description must be at most 500 characters');
  if (!Array.isArray(t.sections) || t.sections.length < 1 || t.sections.length > 30) add('sections', 'Between 1 and 30 sections required');
  else {
    const ids = new Set<string>();
    t.sections.forEach((s: Section, i) => {
      if (!ID_RE.test(s.id ?? '')) add(`sections.${i}.id`, 'Invalid id');
      else if (ids.has(s.id)) add(`sections.${i}.id`, 'Duplicate id');
      else ids.add(s.id);
      if (!s.title || s.title.length > 80) add(`sections.${i}.title`, 'Title must be 1..80 characters');
      if (s.format === 'key_value' && (!s.fields || s.fields.length === 0)) add(`sections.${i}.fields`, 'key_value sections need at least one field');
    });
  }
  if (details.length) throw new MockApiError(400, 'VALIDATION_ERROR', 'Template validation failed', details);

  return {
    name: t.name!.trim(),
    description: t.description ?? '',
    appointment_type: t.appointment_type ?? 'other',
    species: t.species ?? [],
    sections: t.sections!,
    style: t.style ?? { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
  };
}

// ---------------------------------------------------------------- generation

const SYNONYMS: Record<string, string[]> = {
  subjective: ['history', 'owner', 'says', 'eating', 'appetite', 'weeks', 'noticed'],
  history: ['owner', 'eating', 'appetite', 'weeks', 'noticed', 'before'],
  presenting: ['owner', 'weeks', 'noticed', 'started'],
  assessment: ['suspect', 'diagnos', 'likely', 'looks like', 'otitis', 'disease'],
  plan: ['recommend', 'prescribe', 'recheck', 'mg', 'start', 'schedule'],
  treatment: ['recommend', 'prescribe', 'recheck', 'mg', 'start'],
  findings: ['exam', 'cytology', 'seeing', 'palpable', 'red', 'swollen'],
  oral: ['calculus', 'gingiv', 'tooth', 'mobile', 'fractured'],
  procedure: ['anesthesia', 'radiograph', 'extract', 'cleaning'],
  consent: ['consent', 'estimate', 'dollars', 'cost'],
  home: ['food', 'brushing', 'recheck', 'soft'],
  vaccines: ['vaccine', 'rabies', 'fvrcp', 'prevention'],
  body: ['heart', 'lungs', 'abdomen', 'eyes', 'ears', 'teeth', 'coat'],
  systems: ['heart', 'lungs', 'abdomen', 'eyes', 'ears'],
};

function sentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .replace(/\bDr\./g, 'Dr')
    .split(/\n+/)
    .map((l) => l.replace(/^(Vet|Owner|Doctor|Client)\s*:\s*/i, '').trim())
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

function pick(template: Section, sents: string[], n: number): string[] {
  const words = [...`${template.title} ${template.instructions} ${template.id}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3), ...Object.entries(SYNONYMS).filter(([k]) => `${template.id} ${template.title}`.toLowerCase().includes(k)).flatMap(([, v]) => v)];
  const scored = sents.map((s, i) => ({ s, i, score: words.reduce((a, w) => a + (s.toLowerCase().includes(w) ? 1 : 0), 0) })).filter((x) => x.score > 0);
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
}

const EXTRACT: Record<string, RegExp> = {
  temperature: /\b(\d{2,3}(?:\.\d)?\s?(?:°?\s?[FC]|degrees|fahrenheit))/i,
  heart_rate: /heart rate (?:is |of )?(\d+)/i,
  resp_rate: /respiratory rate (?:is |of )?(\d+)/i,
  weight: /(\d+(?:\.\d+)?\s?(?:kg|kilograms?|lbs?|pounds?))/i,
  bcs: /(?:body condition score|bcs)\s*(?:is )?(\d\s?(?:out of|\/)\s?9)/i,
  mm_crt: /(mucous membranes[^.]*\.)/i,
};

export function generate(tpl: Template, transcript: string): NoteResult {
  const sents = sentences(transcript);
  const used = new Set<string>();
  const sections: ResultSection[] = tpl.sections.map((s) => {
    const base: ResultSection = { section_id: s.id, title: s.title, format: s.format, content: '', items: [], fields: [], not_discussed: false, used_defaults: false };
    if (s.format === 'key_value') {
      base.fields = s.fields.map((f) => {
        const m = EXTRACT[f.key]?.exec(transcript);
        return { key: f.key, label: f.label, value: m ? (m[1] ?? m[0]).trim() : '' };
      });
      base.not_discussed = base.fields.every((f) => !f.value);
      return base;
    }
    const hits = pick(s, sents.filter((x) => !used.has(x)), s.format === 'paragraph' ? 3 : 4);
    hits.forEach((h) => used.add(h));
    if (hits.length === 0) {
      if (s.missing_behavior === 'use_normal_defaults' && s.normal_defaults) {
        if (s.format === 'paragraph') base.content = s.normal_defaults;
        else base.items = [s.normal_defaults];
        base.used_defaults = true;
      } else base.not_discussed = true;
      return base;
    }
    if (s.format === 'paragraph') base.content = hits.join(' ');
    else base.items = hits;
    if (s.missing_behavior === 'use_normal_defaults') {
      base.used_defaults = true;
      const extra = s.normal_defaults ? ` Not mentioned (defaults): ${s.normal_defaults}` : '';
      if (s.format === 'paragraph') base.content += extra;
    }
    return base;
  });
  const first = sents.find((x) => x.length > 45) ?? sents[0] ?? 'Consultation transcript.';
  return {
    visit_summary: first.length > 160 ? `${first.slice(0, 157)}…` : first,
    sections,
    action_items: sents.filter((x) => /recheck|schedule|call us|follow[- ]up|book/i.test(x)).slice(0, 3),
    review_flags: /\b(mg|milligrams?)\b/i.test(transcript) ? ['A medication dose was mentioned — confirm drug, dose and frequency before filing.'] : [],
  };
}

// ----------------------------------------------------------------- rendering

export function renderText(result: NoteResult, tpl: Template): string {
  const mb = new Map(tpl.sections.map((s) => [s.id, s.missing_behavior]));
  const out: string[] = [];
  for (const s of result.sections) {
    const b = mb.get(s.section_id) ?? 'omit';
    if (s.not_discussed && b === 'omit') continue;
    let body: string;
    if (s.not_discussed) body = 'Not discussed.';
    else if (s.format === 'paragraph') body = s.content;
    else if (s.format === 'bullets') body = s.items.map((i) => `- ${i}`).join('\n');
    else body = s.fields.map((f) => `${f.label}: ${f.value}`).join('\n');
    out.push(`${s.title}\n${body}`);
  }
  if (result.action_items.length) out.push(`Action items\n${result.action_items.map((i) => `- ${i}`).join('\n')}`);
  return out.join('\n\n');
}

export function renderMarkdown(result: NoteResult, tpl: Template): string {
  return renderText(result, tpl)
    .split('\n\n')
    .map((block) => {
      const [title, ...rest] = block.split('\n');
      return `## ${title}\n\n${rest.join('\n')}`;
    })
    .join('\n\n');
}
