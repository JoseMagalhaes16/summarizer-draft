import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  CreateNoteInput,
  Health,
  Note,
  NoteResult,
  NoteSummary,
  Template,
  TemplateInput,
} from './types';

export const NOTE_POLL_MS = 1500;

export const keys = {
  health: ['health'] as const,
  templates: ['templates'] as const,
  template: (id: string) => ['templates', id] as const,
  notes: ['notes'] as const,
  note: (id: string) => ['notes', id] as const,
};

export function isActive(status: Note['status'] | undefined): boolean {
  return status === 'pending' || status === 'processing';
}

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => api.get<Health>('/v1/health', signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------- templates

export function useTemplates() {
  return useQuery({
    queryKey: keys.templates,
    queryFn: async ({ signal }) => (await api.get<{ items: Template[] }>('/v1/templates', signal)).items,
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: keys.template(id ?? ''),
    queryFn: ({ signal }) => api.get<Template>(`/v1/templates/${id}`, signal),
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) => api.post<Template>('/v1/templates', input),
    onSuccess: (t) => {
      qc.setQueryData(keys.template(t.id), t);
      void qc.invalidateQueries({ queryKey: keys.templates, exact: true });
    },
  });
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) => api.put<Template>(`/v1/templates/${id}`, input),
    onSuccess: (t) => {
      qc.setQueryData(keys.template(id), t);
      void qc.invalidateQueries({ queryKey: keys.templates, exact: true });
    },
  });
}

export function useDuplicateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      api.post<Template>(`/v1/templates/${id}/duplicate`, name ? { name } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.templates, exact: true }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/v1/templates/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: keys.template(id) });
      void qc.invalidateQueries({ queryKey: keys.templates, exact: true });
    },
  });
}

// -------------------------------------------------------------------- notes

export function useNotes(limit = 50) {
  return useQuery({
    queryKey: [...keys.notes, 'list', limit],
    queryFn: async ({ signal }) =>
      (await api.get<{ items: NoteSummary[] }>(`/v1/notes?limit=${limit}`, signal)).items,
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: keys.note(id ?? ''),
    queryFn: ({ signal }) => api.get<Note>(`/v1/notes/${id}`, signal),
    enabled: !!id,
    // Poll while the note is still being generated.
    refetchInterval: (query) => (isActive(query.state.data?.status) ? NOTE_POLL_MS : false),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api.post<Note>('/v1/notes', input),
    onSuccess: (n) => {
      qc.setQueryData(keys.note(n.id), n);
      void qc.invalidateQueries({ queryKey: [...keys.notes, 'list'] });
    },
  });
}

export function useUpdateNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (result: NoteResult) => api.patch<Note>(`/v1/notes/${id}`, { result }),
    onSuccess: (n) => {
      qc.setQueryData(keys.note(id), n);
      // PATCH may omit rendered_text; refetch to pick up the server rendering.
      void qc.invalidateQueries({ queryKey: keys.note(id), exact: true });
      void qc.invalidateQueries({ queryKey: [...keys.notes, 'list'] });
    },
  });
}

export function useRegenerateNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId?: string) =>
      api.post<Note>(`/v1/notes/${id}/regenerate`, templateId ? { template_id: templateId } : {}),
    onSuccess: (n) => {
      qc.setQueryData(keys.note(id), n);
      void qc.invalidateQueries({ queryKey: [...keys.notes, 'list'] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/v1/notes/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: keys.note(id) });
      void qc.invalidateQueries({ queryKey: [...keys.notes, 'list'] });
    },
  });
}
