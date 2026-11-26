import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { ApiError, api } from './client';

describe('api client', () => {
  it('returns parsed JSON on success', async () => {
    server.use(http.get('*/v1/health', () => HttpResponse.json({ status: 'ok', llm_provider: 'mock', storage: 'memory' })));
    await expect(api.get('/v1/health')).resolves.toEqual({ status: 'ok', llm_provider: 'mock', storage: 'memory' });
  });

  it('resolves undefined for 204', async () => {
    server.use(http.delete('*/v1/notes/x', () => new HttpResponse(null, { status: 204 })));
    await expect(api.del('/v1/notes/x')).resolves.toBeUndefined();
  });

  it('throws ApiError built from the {"error": {...}} envelope', async () => {
    server.use(
      http.post('*/v1/notes', () =>
        HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: [{ field: 'transcript' }] } }, { status: 400 }),
      ),
    );
    const err = await api.post('/v1/notes', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.message).toBe('Invalid request');
    expect(e.details).toEqual([{ field: 'transcript' }]);
  });

  it('flags 404 as not found', async () => {
    server.use(http.get('*/v1/notes/zzz', () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'nope' } }, { status: 404 })));
    const e = (await api.get('/v1/notes/zzz').catch((x: unknown) => x)) as ApiError;
    expect(e.isNotFound).toBe(true);
    expect(e.code).toBe('NOT_FOUND');
  });

  it('falls back to a generic error for non-JSON failures', async () => {
    server.use(http.get('*/v1/templates', () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })));
    const e = (await api.get('/v1/templates').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(502);
    expect(e.code).toBe('HTTP_502');
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    server.use(http.get('*/v1/health', () => HttpResponse.error()));
    const e = (await api.get('/v1/health').catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.status).toBe(0);
  });

  it('sends JSON bodies with content-type', async () => {
    let seen: { ct: string | null; body: unknown } | undefined;
    server.use(
      http.put('*/v1/templates/t1', async ({ request }) => {
        seen = { ct: request.headers.get('content-type'), body: await request.json() };
        return HttpResponse.json({ ok: true });
      }),
    );
    await api.put('/v1/templates/t1', { name: 'x' });
    expect(seen).toEqual({ ct: 'application/json', body: { name: 'x' } });
  });
});
