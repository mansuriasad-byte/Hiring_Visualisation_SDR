import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './auth.tsx';

export default function App() {
  const { isAdmin, authRequired, signOut } = useAuth();
  const [health, setHealth] = useState<string>('');
  useEffect(() => {
    fetch(`${(import.meta as any).env?.VITE_API_BASE ?? ''}/api/health`)
      .then((r) => r.json())
      .then((d) => setHealth(d.airtable === 'configured' ? 'connected' : 'dry-run'))
      .catch(() => setHealth('offline'));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Leena AI <span>· Hiring Pipeline</span>
        </div>
        <nav className="nav">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/pivot">Pivot</NavLink>
          <NavLink to="/candidates">Candidates</NavLink>
          {isAdmin && <NavLink to="/sync">Sync</NavLink>}
          {isAdmin && <NavLink to="/upload">Upload</NavLink>}
        </nav>
        <div className="topbar-right">
          <span className={`status status-${health}`}>{health || '…'}</span>
          {isAdmin && <span className="role-badge">admin</span>}
          {authRequired && <button className="secondary signout" onClick={signOut}>Sign out</button>}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
