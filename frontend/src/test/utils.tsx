import { type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '../components/Toast';
import type { Note, Section, Template } from '../api/types';

export function renderApp(ui: ReactElement, { route = '/', path = '/' }: { route?: string; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

export function makeSection(p: Partial<Section> = {}): Section {
  return { id: 'subjective', title: 'Subjective', instructions: '', format: 'paragraph', fields: [], required: true, missing_behavior: 'state_not_discussed', normal_defaults: '', ...p };
}

export function makeTemplate(p: Partial<Template> = {}): Template {
  return {
    id: 'builtin-soap',
    name: 'SOAP – General Consult',
    description: 'General consult',
    appointment_type: 'general',
    species: [],
    is_builtin: true,
    sections: [makeSection()],
    style: { tone: 'clinical', use_abbreviations: true, custom_instructions: '' },
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...p,
  };
}

export function makeNote(p: Partial<Note> = {}): Note {
  const t = makeTemplate();
  return {
    id: 'N1',
    template_id: t.id,
    template_name: t.name,
    template_snapshot: t,
    patient: { name: 'Bella', species: 'canine' },
    clinician: '',
    transcript: 'Vet: hello',
    status: 'pending',
    generation_id: null,
    error: null,
    result: null,
    edited: false,
    model_info: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...p,
  };
}
