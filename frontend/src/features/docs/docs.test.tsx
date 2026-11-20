import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../../app/routes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../components/Toast';
import { Diagram } from './Diagram';
import { RequestInspector, highlightBlocks } from './RequestInspector';

// mermaid can't lay out in jsdom; make its lazy import fail so diagrams show their fallback.
vi.mock('mermaid', () => {
  throw new Error('mermaid unavailable in tests');
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Docs routes', () => {
  it.each([
    ['/docs', 'How VetScribe works'],
    ['/docs/prompt', 'The prompt'],
    ['/docs/behaviours', 'Edge cases'],
    ['/docs/bedrock', 'The Bedrock request'],
    ['/docs/calls', 'One call or two?'],
    ['/docs/multiple-outputs', 'SOAP and client note from one transcript'],
    ['/docs/evals', 'Evaluations'],
  ])('%s renders its heading, sub-nav and a Docs entry in the sidebar', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    const sub = screen.getByRole('navigation', { name: 'Docs' });
    expect(within(sub).getAllByRole('link')).toHaveLength(7);
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Docs' })).toBeInTheDocument();
  });
});

describe('Edge cases page', () => {
  it('lists 13 edge cases in its table', async () => {
    renderAt('/docs/behaviours');
    const table = await screen.findByRole('table', { name: /edge cases/i });
    expect(within(table).getAllByRole('row')).toHaveLength(14);
  });
});

describe('Evaluations page', () => {
  it('has the three parts and a nine-row expectation table', async () => {
    renderAt('/docs/evals');
    expect(await screen.findByRole('heading', { level: 2, name: 'How is an eval built?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'What does an eval contain?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'How is an eval run?' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /expectation/i });
    expect(within(table).getAllByRole('row')).toHaveLength(10); // header + 9
  });
});

describe('Diagram', () => {
  it('falls back to the source in a <pre> when mermaid fails to load', async () => {
    render(<Diagram source={'flowchart LR\n  A --> B'} caption="Cap" description="A goes to B" />);
    const pre = await screen.findByTestId('diagram-fallback');
    expect(pre.tagName).toBe('PRE');
    expect(pre).toHaveTextContent('A --> B');
    expect(screen.getByText('Cap').tagName).toBe('FIGCAPTION');
    expect(screen.getByText('A goes to B')).toHaveClass('sr-only');
  });
});

describe('RequestInspector', () => {
  it('switches template and mode and shows the matching parts', async () => {
    const user = userEvent.setup();
    render(<RequestInspector />);
    await screen.findByRole('tab', { name: 'JSON schema' });
    await user.click(screen.getByRole('tab', { name: 'User message' }));
    const panel = () => screen.getByRole('tabpanel');
    expect(panel()).toHaveTextContent('<name>SOAP - General Consult</name>');
    expect(panel().querySelector('[data-block="transcript"]')).not.toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Client discharge' }));
    expect(panel()).toHaveTextContent('<name>Client Discharge Summary</name>');

    await user.click(screen.getByRole('radio', { name: 'Tool call' }));
    await user.click(screen.getByRole('tab', { name: 'Tool definition' }));
    expect(panel()).toHaveTextContent('record_clinical_note');
    await user.click(screen.getByRole('tab', { name: 'Full request body' }));
    expect(panel()).toHaveTextContent('"tool_choice"');

    await user.click(screen.getByRole('radio', { name: 'Structured output' }));
    expect(screen.getByRole('tab', { name: 'JSON schema' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/export_prompt_example\.py/)).toBeInTheDocument());
  });

  it('wraps the template, patient and transcript blocks', () => {
    const out = highlightBlocks('intro\n<template>a</template>\n<patient>b</patient>\n<transcript>c</transcript>');
    const { container } = render(<pre>{out}</pre>);
    expect([...container.querySelectorAll('[data-block]')].map((e) => e.getAttribute('data-block'))).toEqual(['template', 'patient', 'transcript']);
  });
});
