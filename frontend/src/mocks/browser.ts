import { setupWorker } from 'msw/browser';
import { createHandlers } from './handlers';

/** Frontend-only demo mode: `npm run dev:mock` (VITE_USE_MSW=true). */
export async function startMockWorker() {
  const { handlers } = createHandlers();
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true });
  console.info('[VetScribe] Running against the in-browser mock API (msw).');
}
