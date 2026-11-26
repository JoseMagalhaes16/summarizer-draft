import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderApp } from '../../test/utils';
import type { NoteSummary } from '../../api/types';
import { NotesPage } from './NotesPage';

const row = (p: Partial<NoteSummary>): NoteSummary => ({
  id: 'A',
  template_id: 't',
  template_name: 'SOAP',
  patient: { name: 'Bella' },
  status: 'completed',
  source: 'ai',
  visit_summary: 'Itchy ears',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...p,
});

describe('NotesPage', () => {
  it('marks manual notes with the word Manual', async () => {
    server.use(http.get('*/v1/notes', () => HttpResponse.json({ items: [row({ id: 'A' }), row({ id: 'B', patient: { name: 'Juniper' }, source: 'manual' })] })));
    renderApp(<NotesPage />);
    const juniper = (await screen.findByRole('link', { name: 'Juniper' })).closest('tr')!;
    expect(within(juniper).getByText('Manual')).toBeInTheDocument();
    const bella = screen.getByRole('link', { name: 'Bella' }).closest('tr')!;
    expect(within(bella).queryByText('Manual')).not.toBeInTheDocument();
  });
});
