import { useEffect, useState } from 'react';
import { fetchCalendarStatus, runCalendarSync } from '../api.ts';

interface CalSource { id: string; name?: string; email?: string; type?: string; active?: boolean; lastSynced?: string; fields?: Record<string, any> }
const f = (s: CalSource, key: string) => (s as any)[key] ?? s.fields?.[key] ?? '';

export default function Sync() {
  const [status, setStatus] = useState<{ ready: boolean; google: string; airtable: string; sources: CalSource[] } | null>(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const load = () => fetchCalendarStatus().then(setStatus).catch((e) => setErr(String(e.message)));
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setRunning(true); setErr(''); setResult(null);
    try {
      // No `since` → incremental: only events updated since each calendar's
      // last sync are pulled, then deduped on iCalUID.
      const r = await runCalendarSync({});
      setResult(r);
      await load();
    } catch (e: any) {
      setErr(String(e.message));
    } finally {
      setRunning(false);
    }
  };

  const sources = status?.sources ?? [];

  return (
    <div>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: '0 0 4px' }}>Calendar sync</h3>
            <div className="muted">
              Pulls interview events from the TA coordinators' calendars. First run backfills;
              after that it only fetches events updated since the last run and dedupes them.
            </div>
          </div>
          <button onClick={sync} disabled={running || !status?.ready}>
            {running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        {status && !status.ready && (
          <div style={{ color: 'var(--warn)', marginTop: 12 }}>
            Not ready — Google: {status.google}; Airtable: {status.airtable}.
            {status.google !== 'connected' && <> Authorize at <code>/auth/google</code> first.</>}
          </div>
        )}
        {err && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{err}</div>}
      </div>

      {result && (
        <div className="panel">
          <h3>Last run</h3>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--muted)' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <h3 style={{ padding: '16px 16px 0', margin: 0 }}>Calendar sources</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Type</th><th>Active</th><th>Last synced</th></tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} style={{ cursor: 'default' }}>
                <td>{f(s, 'name') || f(s, 'Name')}</td>
                <td className="muted">{f(s, 'email') || f(s, 'Email')}</td>
                <td>{f(s, 'type') || f(s, 'Type')}</td>
                <td>{(f(s, 'active') || f(s, 'Active')) ? '✓' : '—'}</td>
                <td className="muted">{f(s, 'lastSynced') || f(s, 'Last Synced') || 'never'}</td>
              </tr>
            ))}
            {!sources.length && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>No calendar sources configured.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
