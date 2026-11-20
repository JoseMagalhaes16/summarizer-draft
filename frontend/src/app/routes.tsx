import { Link, type RouteObject } from 'react-router';
import { Layout } from './Layout';
import { NewNotePage } from '../features/notes/NewNotePage';
import { NotePage } from '../features/notes/NotePage';
import { NotesPage } from '../features/notes/NotesPage';
import { TemplatesPage } from '../features/templates/TemplatesPage';
import { TemplateEditorPage } from '../features/templates/TemplateEditorPage';
import { EvalsLayout } from '../features/evals/EvalsLayout';
import { RunsPage } from '../features/evals/RunsPage';
import { NewRunPage } from '../features/evals/NewRunPage';
import { RunDetailPage } from '../features/evals/RunDetailPage';
import { ComparePage } from '../features/evals/ComparePage';
import { CasesPage } from '../features/evals/CasesPage';
import { CaseDetailPage } from '../features/evals/CaseDetailPage';
import { EmptyState } from '../components/ui';

function NotFound() {
  return (
    <div className="page">
      <EmptyState icon="info" title="Page not found" action={<Link className="btn btn-primary" to="/">Back to New note</Link>}>
        The page you were looking for doesn&rsquo;t exist.
      </EmptyState>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <NewNotePage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'notes/:id', element: <NotePage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'templates/new', element: <TemplateEditorPage /> },
      { path: 'templates/:id', element: <TemplateEditorPage /> },
      {
        path: 'evals',
        element: <EvalsLayout />,
        children: [
          { index: true, element: <RunsPage /> },
          { path: 'new', element: <NewRunPage /> },
          { path: 'runs/:id', element: <RunDetailPage /> },
          { path: 'compare', element: <ComparePage /> },
          { path: 'cases', element: <CasesPage /> },
          { path: 'cases/:id', element: <CaseDetailPage /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
