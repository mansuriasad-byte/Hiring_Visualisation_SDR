import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchMe, login as apiLogin, setSession, clearSession, getRole } from './api.ts';

interface AuthState {
  ready: boolean;
  authRequired: boolean;
  role: string | null;
  isAdmin: boolean;
  signIn: (password: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [role, setRole] = useState<string | null>(getRole() || null);

  const refresh = async () => {
    try {
      const me = await fetchMe();
      setAuthRequired(me.authRequired);
      setRole(me.role);
      if (!me.authRequired && !me.role) {
        // Auth disabled — mint a local admin session so the UI shows admin tools.
        await signIn('');
      }
    } catch {
      setRole(null);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    refresh();
    const onUnauth = () => { setRole(null); };
    window.addEventListener('ht-unauthorized', onUnauth);
    return () => window.removeEventListener('ht-unauthorized', onUnauth);
  }, []);

  const signIn = async (password: string) => {
    const r = await apiLogin(password);
    setSession(r.token, r.role);
    setAuthRequired(r.authRequired);
    setRole(r.role);
  };

  const signOut = () => { clearSession(); setRole(null); };

  return (
    <Ctx.Provider value={{ ready, authRequired, role, isAdmin: role === 'admin', signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await signIn(pw); }
    catch (e: any) { setErr(e.message.includes('401') ? 'Incorrect password.' : String(e.message)); setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ fontSize: 18, marginBottom: 4 }}>Leena AI <span>· Hiring Pipeline</span></div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>Enter the access password to continue.</p>
        <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div style={{ color: 'var(--danger)', marginTop: 10 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ marginTop: 14, width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
