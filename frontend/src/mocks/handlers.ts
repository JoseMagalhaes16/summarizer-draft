import { http, HttpResponse, delay } from 'msw';
import { MockApiError, MockEngine, type MockOptions } from './engine';
import { EvalMockEngine, type EvalMockOptions } from './evalEngine';

/** msw request handlers backed by an in-memory MockEngine (spec section 5). */
export function createHandlers(opts?: MockOptions & EvalMockOptions & { latencyMs?: number }) {
  const engine = new MockEngine(opts);
  const evals = new EvalMockEngine(opts);
  const latency = opts?.latencyMs ?? 120;

  async function run<T>(fn: () => T, status = 200): Promise<Response> {
    if (latency) await delay(latency);
    try {
      const out = fn();
      if (out === undefined) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(out as object, { status });
    } catch (e) {
      if (e instanceof MockApiError) {
        return HttpResponse.json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, { status: e.status });
      }
      throw e;
    }
  }
  const body = async (req: Request) => {
    try {
      return await req.json();
    } catch {
      throw new MockApiError(400, 'VALIDATION_ERROR', 'Request body must be valid JSON');
    }
  };

  const handlers = [
    http.get('*/v1/health', () => run(() => engine.health())),
    http.get('*/v1/templates', () => run(() => engine.listTemplates())),
    http.post('*/v1/templates', async ({ request }) => {
      try {
        const b = await body(request);
        return run(() => engine.createTemplate(b), 201);
      } catch (e) {
        return run(() => { throw e; });
      }
    }),
    http.get('*/v1/templates/:id', ({ params }) => run(() => engine.getTemplate(String(params.id)))),
    http.put('*/v1/templates/:id', async ({ request, params }) => {
      try {
        const b = await body(request);
        return run(() => engine.updateTemplate(String(params.id), b));
      } catch (e) {
        return run(() => { throw e; });
      }
    }),
    http.delete('*/v1/templates/:id', ({ params }) => run(() => engine.deleteTemplate(String(params.id)))),
    http.post('*/v1/templates/:id/duplicate', async ({ request, params }) => {
      const b = await request.json().catch(() => ({}));
      return run(() => engine.duplicateTemplate(String(params.id), b), 201);
    }),
    http.post('*/v1/notes', async ({ request }) => {
      try {
        const b = await body(request);
        return run(() => engine.createNote(b), 202);
      } catch (e) {
        return run(() => { throw e; });
      }
    }),
    http.get('*/v1/notes', ({ request }) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50) || 50;
      return run(() => engine.listNotes(limit));
    }),
    http.get('*/v1/notes/:id', ({ params }) => run(() => engine.getNote(String(params.id)))),
    http.patch('*/v1/notes/:id', async ({ request, params }) => {
      try {
        const b = await body(request);
        return run(() => engine.patchNote(String(params.id), b));
      } catch (e) {
        return run(() => { throw e; });
      }
    }),
    http.post('*/v1/notes/:id/regenerate', async ({ request, params }) => {
      const b = await request.json().catch(() => ({}));
      return run(() => engine.regenerateNote(String(params.id), b), 202);
    }),
    http.delete('*/v1/notes/:id', ({ params }) => run(() => engine.deleteNote(String(params.id)))),
    http.get('*/v1/evals/cases', () => run(() => evals.listCases())),
    http.get('*/v1/evals/cases/:id', ({ params }) => run(() => evals.getCase(String(params.id)))),
    http.get('*/v1/evals/runs', () => run(() => evals.listRuns())),
    http.post('*/v1/evals/runs', async ({ request }) => {
      try {
        const b = await body(request);
        return run(() => evals.createRun(b), 202);
      } catch (e) {
        return run(() => { throw e; });
      }
    }),
    http.get('*/v1/evals/runs/:id', ({ params }) => run(() => evals.getRun(String(params.id)))),
    http.get('*/v1/evals/runs/:id/results', ({ params }) => run(() => evals.getResults(String(params.id)))),
    http.get('*/v1/evals/compare', ({ request }) => {
      const u = new URL(request.url);
      return run(() => evals.compare(u.searchParams.get('base'), u.searchParams.get('candidate')));
    }),
  ];
  return { handlers, engine, evals };
}
