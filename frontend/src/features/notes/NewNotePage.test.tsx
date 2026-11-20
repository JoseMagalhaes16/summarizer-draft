import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { makeNote, makeTemplate, renderApp } from '../../test/utils';
import { MAX_TRANSCRIPT_CHARS } from '../../api/types';
import { validateNewNote } from './newNoteValidation';
import { NewNotePage } from './NewNotePage';

const templates = [makeTemplate(), makeTemplate({ id: 'builtin-dental', name: 'Dental (COHAT)', appointment_type: 'dental' })];

beforeEach(() => {
  server.use(http.get('*/v1/templates', () => HttpResponse.json({ items: templates })));
});

describe('validateNewNote', () => {
  it('needs template and non-blank transcript within the limit', () => {
    expect(validateNewNote(null, 'x').errors.template).toBeTruthy();
    expect(validateNewNote('t', '   ').errors.transcript).toBeTruthy();
    expect(validateNewNote('t', 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1)).valid).toBe(false);
    expect(validateNewNote('t', 'x'.repeat(MAX_TRANSCRIPT_CHARS)).valid).toBe(true);
  });
});

describe('NewNotePage', () => {
  it('disables Generate until a transcript is entered, then enables it', async () => {
    renderApp(<NewNotePage />);
    const btn = screen.getByRole('button', { name: /generate note/i });
    expect(btn).toBeDisabled();

    await screen.findByRole('radio', { name: /SOAP/ }); // templates loaded
    expect(await screen.findByRole('radio', { name: /SOAP/ })).toBeChecked(); // first preselected
    expect(btn).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Transcript'), 'Vet: hello');
    expect(btn).toBeEnabled();

    await userEvent.clear(screen.getByLabelText('Transcript'));
    expect(btn).toBeDisabled();
  });

  it('shows a character counter', async () => {
    renderApp(<NewNotePage />);
    await userEvent.type(screen.getByLabelText('Transcript'), 'abc');
    expect(screen.getByText(/3 \/ 200,000 characters/)).toBeInTheDocument();
  });

  it('loads a sample transcript, selects the matching template and fills patient fields', async () => {
    renderApp(<NewNotePage />);
    await screen.findByRole('radio', { name: /Dental/ });
    await userEvent.click(screen.getByRole('button', { name: /load sample/i }));
    await userEvent.click(screen.getByRole('button', { name: /pre-dental/i }));
    expect((screen.getByLabelText('Transcript') as HTMLTextAreaElement).value.length).toBeGreaterThan(1000);
    expect(screen.getByRole('radio', { name: /Dental/ })).toBeChecked();
    expect(screen.getByLabelText('Patient name')).toHaveValue('Pepper');
    expect(screen.getByRole('button', { name: /generate note/i })).toBeEnabled();
  });

  it('submits and navigates to the note page', async () => {
    let posted: unknown;
    server.use(
      http.post('*/v1/notes', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(makeNote({ id: 'NEW1' }), { status: 202 });
      }),
    );
    renderApp(<NewNotePage />);
    await screen.findByRole('radio', { name: /SOAP/ });
    await userEvent.type(screen.getByLabelText('Transcript'), 'Vet: hi');
    await userEvent.click(screen.getByRole('button', { name: /generate note/i }));
    await waitFor(() => expect(screen.getByText('elsewhere')).toBeInTheDocument());
    expect(posted).toMatchObject({ template_id: 'builtin-soap', transcript: 'Vet: hi' });
  });

  it('shows the server error when creation fails', async () => {
    server.use(http.post('*/v1/notes', () => HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Transcript too long' } }, { status: 400 })));
    renderApp(<NewNotePage />);
    await screen.findByRole('radio', { name: /SOAP/ });
    await userEvent.type(screen.getByLabelText('Transcript'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /generate note/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transcript too long');
  });
});
