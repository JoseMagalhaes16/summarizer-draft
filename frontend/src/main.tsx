import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { routes } from './app/routes';
import { createQueryClient } from './app/queryClient';
import { ToastProvider } from './components/Toast';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';

async function bootstrap() {
  if (import.meta.env.VITE_USE_MSW === 'true') {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }
  const router = createBrowserRouter(routes);
  const queryClient = createQueryClient();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
