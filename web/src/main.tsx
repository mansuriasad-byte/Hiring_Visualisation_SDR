import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import App from './App.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Candidates from './pages/Candidates.tsx';
import Pivot from './pages/Pivot.tsx';
import Sync from './pages/Sync.tsx';
import Upload from './pages/Upload.tsx';
import { AuthProvider, LoginScreen, useAuth } from './auth.tsx';
import './styles.css';

function RequireAdmin({ children }: { children: React.ReactElement }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/dashboard" replace />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'candidates', element: <Candidates /> },
      { path: 'pivot', element: <Pivot /> },
      { path: 'sync', element: <RequireAdmin><Sync /></RequireAdmin> },
      { path: 'upload', element: <RequireAdmin><Upload /></RequireAdmin> },
    ],
  },
]);

function Root() {
  const { ready, authRequired, role } = useAuth();
  if (!ready) return <div className="loading">Loading…</div>;
  if (authRequired && !role) return <LoginScreen />;
  return <RouterProvider router={router} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </React.StrictMode>,
);
