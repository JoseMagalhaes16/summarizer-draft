import { NavLink, Outlet } from 'react-router';
import { useHealth } from '../api/hooks';
import { Icon } from '../components/Icon';

export function Layout() {
  const health = useHealth();
  const isMock = health.data?.llm_provider === 'mock';

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="VetScribe home">
          <span className="brand-mark">
            <Icon name="logo" size={18} strokeWidth={3} />
          </span>
          <span className="brand-name">VetScribe</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            <Icon name="plus" />
            <span className="nav-label">New note</span>
          </NavLink>
          <NavLink to="/notes">
            <Icon name="list" />
            <span className="nav-label">Notes</span>
          </NavLink>
          <NavLink to="/templates">
            <Icon name="template" />
            <span className="nav-label">Templates</span>
          </NavLink>
        </nav>
        <div className="sidebar-foot">Drafts only. Check each note before filing.</div>
      </aside>
      <div className="main">
        <div className="topbar">
          {isMock && (
            <span className="pill-mock" title="Notes are produced by a deterministic offline generator, not a real model.">
              <span className="pill-dot" aria-hidden="true" />
              Mock mode
            </span>
          )}
        </div>
        <main id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
