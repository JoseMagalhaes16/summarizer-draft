import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { makeNote, makeSection, makeTemplate, renderApp } from '../../test/utils';
import type { Note } from '../../api/types';
import { NotePage } from './NotePage';

const completed = (): Note =>
  makeNote({
    status: 'completed',
    template_snapshot: makeTemplate({
      sections: [
        makeSection({ id: 'subjective', title: 'Subjective' }),
        makeSection({ id: 'plan', title: 'Plan', format: 'bullets', missing_behavior: 'omit' }),
        makeSection({ id: 'objective', title: 'Objective', format: 'key_value', missing_behavior: 'use_normal_defaults' }),
      ],
    }),
    result: {
      visit_summary: 'Itchy ears for 3 weeks.',
      sections: [
        { section_id: 'subjective', title: 'Subjective', format: 'paragraph', content: 'Head shaking.', items: [], fields: [], not_discussed: false, used_defaults: false },
        { section_id: 'plan', title: 'Plan', format: 'bullets', content: '', items: [], fields: [], not_discussed: true, used_defaults: false },
        {
          section_id: 'objective',
          title: 'Objective',
          format: 'key_value',
          content: '',
          items: [],
          fields: [
            { key: 'weight', label: 'Weight', value: '34 kg' },
            { key: 'hr', label: 'Heart rate', value: '' },
          ],
          not_discussed: false,
          used_defaults: true,
        },
      ],
      action_items: ['Recheck in 14 days'],
      review_flags: ['Confirm carprofen dose'],
    },
    model_info: { provider: 'mock', model_id: 'mock-1', input_tokens: 1200, output_tokens: 300, latency_ms: 2500 },
    rendered_text: 'Subjective\nHead shaking.',
  });

const noTemplates = http.get('*/v1/templates', () => HttpResponse.json({ items: [] }));
const open = () => renderApp(<NotePage />, { route: '/notes/N1', path: '/notes/:id' });

describe('NotePage polling', () => {
  it('polls while pending/processing and stops once completed', async () => {
    const seq: Note[] = [makeNote({ status: 'pending' }), makeNote({ status: 'processing' }), completed()];
    let calls = 0;
    server.use(
      http.get('*/v1/notes/N1', () => {
        const n = seq[Math.min(calls, seq.length - 1)];
        calls++;
        return HttpResponse.json(n);
      }),
      noTemplates,
    );
    open();

    expect(await screen.findByText('Queued…')).toBeInTheDocument();
    expect(await screen.findByText(/drafting your note/i, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('Itchy ears for 3 weeks.', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(calls).toBe(3);

    // No further polling after completion.
    await new Promise((r) => setTimeout(r, 1800));
    expect(calls).toBe(3);
  }, 15000);

  it('announces progress as a busy status region', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(makeNote({ status: 'processing' }))), noTemplates);
    open();
    await screen.findByText(/drafting your note/i);
    const busy = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
    expect(busy).toHaveTextContent(/drafting your note/i);
  });
});

describe('NotePage record sheet', () => {
  it('renders the sheet with margin headings, no format badges, hidden empty sections and the sticky rail', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(completed())), noTemplates);
    const { container } = open();

    expect(await screen.findByText('Itchy ears for 3 weeks.')).toBeInTheDocument();
    const sheet = screen.getByRole('article', { name: /note for bella/i });
    expect(within(sheet).getByRole('heading', { name: 'Subjective' })).toBeInTheDocument();
    expect(within(sheet).getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('heading', { name: 'Plan' })).not.toBeInTheDocument();
    // no "Paragraph" / "Key value" / "Bullets" badges anywhere in the sheet
    expect(sheet.querySelector('.badge')).toBeNull();
    expect(sheet).not.toHaveTextContent(/paragraph|key.?value|bullets/i);
    // no all-caps eyebrow labels
    expect(container.querySelector('.eyebrow')).toBeNull();

    expect(screen.getByRole('button', { name: /show empty sections \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText(/mock · mock-1 · 1,200 in \/ 300 out tokens · 2.5 s/)).toBeInTheDocument();
  });

  it('shows "not stated" for empty key_value values instead of hiding them', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(completed())), noTemplates);
    open();
    const sheet = await screen.findByRole('article');
    expect(within(sheet).getByText('Heart rate')).toBeInTheDocument();
    expect(within(sheet).getByText('not stated')).toBeInTheDocument();
    expect(within(sheet).getByText('34 kg')).toBeInTheDocument();
  });

  it('lists review flags, normal-defaults sections and follow-ups in the rail', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(completed())), noTemplates);
    open();
    const rail = await screen.findByRole('complementary', { name: 'Review' });
    expect(within(rail).getByRole('heading', { name: /check before filing \(2\)/i })).toBeInTheDocument();
    expect(within(rail).getByText('Confirm carprofen dose')).toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: 'Objective' })).toHaveAttribute('href', '#entry-objective');
    expect(within(rail).getByRole('heading', { name: 'Follow-ups' })).toBeInTheDocument();
    expect(within(rail).getByRole('checkbox', { name: 'Recheck in 14 days' })).toBeInTheDocument();
    // the defaults annotation also sits in the sheet margin
    expect(within(screen.getByRole('article')).getByText('Normal defaults: confirm')).toBeInTheDocument();
  });

  it('copies the note and confirms with a matching toast', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(completed())), noTemplates);
    open();
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy note' }));
    expect(write).toHaveBeenCalledWith('Subjective\nHead shaking.');
    expect(await screen.findByText('Note copied')).toBeInTheDocument();
  });

  it('switches to editing with Save changes / Cancel', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(completed())), noTemplates);
    open();
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Itchy ears for 3 weeks.');
    expect(screen.getByRole('textbox', { name: 'Follow-up 1' })).toBeInTheDocument();
  });
});

describe('NotePage while drafting', () => {
  it.each(['pending', 'processing'] as const)('disables Regenerate and Edit while %s', async (status) => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(makeNote({ status }))), noTemplates);
    open();
    expect(await screen.findByRole('button', { name: /^regenerate$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled();
  });

  it('shows the API message in a toast if regenerate is refused with 409', async () => {
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(completed())),
      noTemplates,
      http.post('*/v1/notes/N1/regenerate', () =>
        HttpResponse.json({ error: { code: 'GENERATION_IN_PROGRESS', message: 'Still drafting. Try again shortly.' } }, { status: 409 }),
      ),
    );
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('Still drafting. Try again shortly.')).toBeInTheDocument();
  });
});

describe('NotePage failures', () => {
  it('shows the error message and code when generation failed', async () => {
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(makeNote({ status: 'failed', error: { code: 'MODEL_REFUSAL', message: 'The model declined.' } }))),
      noTemplates,
    );
    open();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('MODEL_REFUSAL');
    expect(alert).toHaveTextContent('The model declined.');
    expect(within(alert).getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });

  it('renders the GENERATION_TIMEOUT state with a Regenerate button', async () => {
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(makeNote({ status: 'failed', error: { code: 'GENERATION_TIMEOUT', message: 'internal detail' } }))),
      noTemplates,
    );
    open();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Drafting didn't finish. Regenerate to try again.");
    expect(alert).not.toHaveTextContent('internal detail');
    expect(within(alert).getByRole('button', { name: 'Regenerate' })).toBeEnabled();
  });
});

describe('Draft another note', () => {
  const templates = [
    makeTemplate({ id: 'builtin-soap', name: 'SOAP' }),
    makeTemplate({ id: 'builtin-discharge', name: 'Client Discharge Summary', description: 'For the owner' }),
  ];
  const withTemplates = http.get('*/v1/templates', () => HttpResponse.json({ items: templates }));

  it('posts the same transcript and patient with the chosen template, then opens the new note', async () => {
    const note = { ...completed(), transcript: 'Vet: the very same transcript', clinician: 'Dr Fox', patient: { name: 'Bella', species: 'canine' } };
    let posted: unknown = null;
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(note)),
      http.get('*/v1/notes/N2', () => HttpResponse.json(makeNote({ id: 'N2', status: 'pending' }))),
      withTemplates,
      http.post('*/v1/notes', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(makeNote({ id: 'N2', status: 'pending' }), { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderApp(<NotePage />, { route: '/notes/N1', path: '/notes/:id' });
    await user.click(await screen.findByRole('button', { name: /more/i }));
    await user.click(screen.getByRole('button', { name: 'Draft another note' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Current')).toBeInTheDocument();
    await user.click(await within(dialog).findByRole('radio', { name: /Client Discharge Summary/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Draft note' }));
    await screen.findByText('Note drafting started');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(posted).toEqual({ template_id: 'builtin-discharge', transcript: 'Vet: the very same transcript', patient: { name: 'Bella', species: 'canine' }, clinician: 'Dr Fox' });
  });

  it('is disabled while the note is still generating', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(makeNote({ status: 'processing' }))), withTemplates);
    const user = userEvent.setup();
    renderApp(<NotePage />, { route: '/notes/N1', path: '/notes/:id' });
    await user.click(await screen.findByRole('button', { name: /more/i }));
    expect(screen.getByRole('button', { name: 'Draft another note' })).toBeDisabled();
  });
});

describe('Manual notes', () => {
  const manualNote = (p: Partial<Note> = {}): Note => {
    const base = completed();
    return {
      ...base,
      source: 'manual',
      transcript: '',
      model_info: null,
      result: { ...base.result!, review_flags: [], sections: base.result!.sections.map((s) => ({ ...s, used_defaults: false })) },
      ...p,
    };
  };
  const withTemplates = http.get('*/v1/templates', () => HttpResponse.json({ items: [makeTemplate(), makeTemplate({ id: 'builtin-dental', name: 'Dental (COHAT)' })] }));
  const user = () => userEvent.setup();

  it('says it was written manually, has no Regenerate or model line, and hides an empty check rail', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(manualNote())), withTemplates);
    open();
    expect(await screen.findByText('Written manually')).toBeInTheDocument();
    expect(screen.queryByText(/mock-1/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /check before filing/i })).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    // No transcript, so no AI draft to make; but a manual note can always be started.
    expect(screen.queryByRole('button', { name: 'Draft another note' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start another note manually' })).toBeInTheDocument();
  });

  it('offers Draft another note for a manual note with a reference transcript', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(manualNote({ transcript: 'Vet: hi' }))), withTemplates);
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Draft another note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
  });

  it('opens straight in edit mode with ?edit=1, and saves sections with the right flags', async () => {
    const base = manualNote();
    const blank = {
      ...base,
      result: {
        ...base.result!,
        visit_summary: '',
        action_items: [],
        sections: base.result!.sections.map((s) => ({ ...s, content: '', items: [], fields: s.fields.map((f) => ({ ...f, value: '' })), not_discussed: true })),
      },
    };
    let patched: { result: Note['result'] } | undefined;
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(blank)),
      withTemplates,
      http.patch('*/v1/notes/N1', async ({ request }) => {
        patched = (await request.json()) as { result: Note['result'] };
        return HttpResponse.json({ ...blank, edited: true, result: patched.result });
      }),
    );
    renderApp(<NotePage />, { route: '/notes/N1?edit=1', path: '/notes/:id' });
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), 'Limp');
    await userEvent.type(screen.getByRole('textbox', { name: 'Subjective' }), 'Right hind');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    expect(patched!.result!.visit_summary).toBe('Limp');
    const [subj, plan, obj] = patched!.result!.sections;
    expect(subj).toMatchObject({ content: 'Right hind', not_discussed: false });
    expect(plan.not_discussed).toBe(true);
    expect(obj.not_discussed).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('shows the server message if regenerate is refused with MANUAL_NOTE', async () => {
    // An AI note that the server says is manual (stale client).
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(completed())),
      withTemplates,
      http.post('*/v1/notes/N1/regenerate', () => HttpResponse.json({ error: { code: 'MANUAL_NOTE', message: 'Written by hand. Nothing to regenerate.' } }, { status: 409 })),
    );
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('Written by hand. Nothing to regenerate.')).toBeInTheDocument();
  });

  it('starts another note manually for the same patient', async () => {
    let posted: unknown;
    const n9 = { ...completed(), id: 'N9', source: 'manual' as const };
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(completed())),
      withTemplates,
      http.post('*/v1/notes/manual', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(n9, { status: 201 });
      }),
      http.get('*/v1/notes/N9', () => HttpResponse.json(n9)),
    );
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start another note manually' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('radio', { name: /Dental/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create note' }));
    // Lands on the new note, already in edit mode.
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bella');
    expect(posted).toEqual({ template_id: 'builtin-dental', patient: { name: 'Bella', species: 'canine' } });
  });
});

describe('NotePage with AI switched off', () => {
  it('hides Regenerate and Draft another note', async () => {
    server.use(
      http.get('*/v1/health', () => HttpResponse.json({ status: 'ok', llm_provider: 'none', storage: 'memory', ai_enabled: false })),
      http.get('*/v1/notes/N1', () => HttpResponse.json(completed())),
      noTemplates,
    );
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Draft another note' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start another note manually' })).toBeInTheDocument();
  });
});
