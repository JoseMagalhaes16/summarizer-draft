import { screen } from '@testing-library/react';
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
        { section_id: 'objective', title: 'Objective', format: 'key_value', content: '', items: [], fields: [{ key: 'weight', label: 'Weight', value: '34 kg' }], not_discussed: false, used_defaults: true },
      ],
      action_items: ['Recheck in 14 days'],
      review_flags: ['Confirm carprofen dose'],
    },
    model_info: { provider: 'mock', model_id: 'mock-1', input_tokens: 1200, output_tokens: 300, latency_ms: 2500 },
    rendered_text: 'Subjective\nHead shaking.',
  });

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
      http.get('*/v1/templates', () => HttpResponse.json({ items: [] })),
    );
    renderApp(<NotePage />, { route: '/notes/N1', path: '/notes/:id' });

    expect(await screen.findByText('Queued…')).toBeInTheDocument();
    expect(await screen.findByText(/drafting your note/i, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('Itchy ears for 3 weeks.', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(calls).toBe(3);

    // No further polling after completion.
    await new Promise((r) => setTimeout(r, 1800));
    expect(calls).toBe(3);
  }, 15000);

  it('renders a completed note: flags, defaults badge, hidden empty sections, action items, footer', async () => {
    server.use(http.get('*/v1/notes/N1', () => HttpResponse.json(completed())), http.get('*/v1/templates', () => HttpResponse.json({ items: [] })));
    renderApp(<NotePage />, { route: '/notes/N1', path: '/notes/:id' });

    expect(await screen.findByText('Itchy ears for 3 weeks.')).toBeInTheDocument();
    expect(screen.getByText('Needs vet review')).toBeInTheDocument();
    expect(screen.getByText('Confirm carprofen dose')).toBeInTheDocument();
    expect(screen.getByText('Normal defaults — confirm')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show empty sections \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Recheck in 14 days' })).toBeInTheDocument();
    expect(screen.getByText(/Provider: mock/)).toBeInTheDocument();
    expect(screen.getByText(/1,200 in \/ 300 out/)).toBeInTheDocument();
  });

  it('shows the error code and message when generation failed', async () => {
    server.use(
      http.get('*/v1/notes/N1', () => HttpResponse.json(makeNote({ status: 'failed', error: { code: 'MODEL_REFUSAL', message: 'The model declined.' } }))),
      http.get('*/v1/templates', () => HttpResponse.json({ items: [] })),
    );
    renderApp(<NotePage />, { route: '/notes/N1', path: '/notes/:id' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('MODEL_REFUSAL');
    expect(alert).toHaveTextContent('The model declined.');
    expect(screen.getAllByRole('button', { name: /regenerate/i }).length).toBeGreaterThan(0);
  });
});
