import { NavLink, Outlet } from 'react-router';

export function DocsLayout() {
  return (
    <div className="page page-docs">
      <nav className="subnav subnav-scroll" aria-label="Docs">
        <NavLink to="/docs" end>How it works</NavLink>
        <NavLink to="/docs/prompt">Prompt</NavLink>
        <NavLink to="/docs/behaviours">Edge cases</NavLink>
        <NavLink to="/docs/bedrock">Bedrock request</NavLink>
        <NavLink to="/docs/calls">One call or two?</NavLink>
        <NavLink to="/docs/multiple-outputs">SOAP + client note</NavLink>
        <NavLink to="/docs/evals">Evaluations</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
