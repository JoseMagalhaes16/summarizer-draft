import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Default handler: a server with AI on. Tests override it to simulate AI switched off. */
export const server = setupServer(
  http.get('*/v1/health', () => HttpResponse.json({ status: 'ok', llm_provider: 'mock', storage: 'memory', ai_enabled: true })),
);
