import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { makeNote, makeTemplate, renderApp } from '../../test/utils';
import { MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPT_CHARS } from '../../api/types';
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

  it('also enforces the UTF-8 byte limit', () => {
    // 150,000 two-byte characters is within the character limit but over 300,000 bytes.
    const text = 'é'.repeat(MAX_TRANSCRIPT_BYTES / 2 + 1);
    expect(text.length).toBeLessThan(MAX_TRANSCRIPT_CHARS);
    const v = validateNewNote('t', text);
    expect(v.valid).toBe(false);
    expect(v.errors.transcript).toMatch(/300,000 bytes/);
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

  it('hides the counter for short transcripts and shows it near the limit', async () => {
    renderApp(<NewNotePage />);
    const box = screen.getByLabelText('Transcript');
    fireEvent.change(box, { target: { value: 'abc' } });
    expect(screen.queryByText(/of 200,000 characters/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'x'.repeat(180_000) } });
    expect(screen.getByText('180,000 of 200,000 characters')).toBeInTheDocument();
    // multi-byte text reaches the byte limit first, so the byte count is shown
    fireEvent.change(box, { target: { value: 'é'.repeat(140_000) } });
    expect(screen.getByText('280,000 of 300,000 bytes')).toBeInTheDocument();
  });

  it('shows what the limit is and how to fix it when the server answers 413', async () => {
    server.use(http.post('*/v1/notes', () => HttpResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'too big' } }, { status: 413 })));
    renderApp(<NewNotePage />);
    await screen.findByRole('radio', { name: /SOAP/ });
    await userEvent.type(screen.getByLabelText('Transcript'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /generate note/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/200,000 characters/);
    expect(alert).toHaveTextContent(/shorten/i);
  });

  it('suggests the matching template for a sample without changing the selection until asked', async () => {
    renderApp(<NewNotePage />);
    await screen.findByRole('radio', { name: /Dental/ });
    expect(screen.getByRole('radio', { name: /SOAP/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /load sample/i }));
    await userEvent.click(screen.getByRole('button', { name: /pre-dental/i }));
    expect((screen.getByLabelText('Transcript') as HTMLTextAreaElement).value.length).toBeGreaterThan(1000);
    expect(screen.getByLabelText('Patient name')).toHaveValue('Pepper');

    // The picker is untouched; an inline suggestion appears instead.
    expect(screen.getByRole('radio', { name: /SOAP/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Dental/ })).not.toBeChecked();
    const hint = screen.getByText(/this sample fits the/i).closest('p')!;
    expect(hint).toHaveTextContent('This sample fits the Dental (COHAT) template.');

    await userEvent.click(within(hint).getByRole('button', { name: 'Use Dental (COHAT)' }));
    expect(screen.getByRole('radio', { name: /Dental/ })).toBeChecked();
    expect(screen.queryByText(/this sample fits the/i)).not.toBeInTheDocument();
  });

  it('drops the suggestion if the user picks that template themselves', async () => {
    renderApp(<NewNotePage />);
    await screen.findByRole('radio', { name: /Dental/ });
    await userEvent.click(screen.getByRole('button', { name: /load sample/i }));
    await userEvent.click(screen.getByRole('button', { name: /pre-dental/i }));
    await userEvent.click(screen.getByRole('radio', { name: /Dental/ }));
    expect(screen.queryByText(/this sample fits the/i)).not.toBeInTheDocument();
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
