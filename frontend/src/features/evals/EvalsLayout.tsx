import { NavLink, Outlet } from 'react-router';

export function EvalsLayout() {
  return (
    <div className="page page-wide">
      <nav className="subnav" aria-label="Evaluations">
        <NavLink to="/evals" end>
          Runs
        </NavLink>
        <NavLink to="/evals/cases">Cases</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
