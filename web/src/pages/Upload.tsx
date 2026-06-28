import { useState } from 'react';
import { uploadPreview, uploadCommit, type UploadType } from '../api.ts';

const TYPES: { value: UploadType; label: string; hint: string }[] = [
  { value: 'ats', label: 'ATS dump', hint: 'PyJaama per-role candidate export. Requires role + geo (the export has no role column).' },
  { value: 'referral', label: 'Referral dump', hint: 'Employee referral export (all roles). Role/geo parsed from Job Title; SDR US/Europe tagged in scope.' },
  { value: 'offer', label: 'Offer / join status', hint: 'Update-only: patches status + offer/join dates on existing candidates by email. Never creates.' },
];

const ROLES = ['SDR', 'SDR Manager', 'Other'];
const GEOS = ['US', 'Europe', 'ROW'];

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<UploadType | ''>('');
  const [role, setRole] = useState('SDR');
  const [geo, setGeo] = useState('US');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const needsRoleGeo = type === 'ats';
  const ready = file && type && (!needsRoleGeo || (role && geo));

  const reset = () => { setPreview(null); setResult(null); setErr(''); };

  const onFile = (f: File | null) => { setFile(f); reset(); };

  const doPreview = async () => {
    if (!ready) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      setPreview(await uploadPreview(file!, type as UploadType, role, geo));
    } catch (e: any) { setErr(String(e.message)); }
    finally { setBusy(false); }
  };

  const doCommit = async () => {
    if (!ready) return;
    setBusy(true); setErr('');
    try {
      setResult(await uploadCommit(file!, type as UploadType, role, geo));
    } catch (e: any) { setErr(String(e.message)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="panel">
        <h3>Upload a CSV</h3>

        <div className="field">
          <label>1 · Choose file</label>
          <input type="file" accept=".csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {file && <span className="muted" style={{ marginLeft: 10 }}>{file.name}</span>}
        </div>

        <div className="field">
          <label>2 · What kind of file is this?</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {TYPES.map((t) => (
              <label key={t.value} className={`type-opt ${type === t.value ? 'sel' : ''}`}>
                <input type="radio" name="type" checked={type === t.value}
                  onChange={() => { setType(t.value); reset(); }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{t.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{t.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {needsRoleGeo && (
          <div className="filters" style={{ marginBottom: 12 }}>
            <div>
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label>Geo</label>
              <select value={geo} onChange={(e) => setGeo(e.target.value)}>
                {GEOS.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="drawer-actions">
          <button className="secondary" onClick={doPreview} disabled={!ready || busy}>Preview</button>
          <button onClick={doCommit} disabled={!ready || busy}>{busy ? 'Working…' : 'Upload'}</button>
        </div>
        {err && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{err}</div>}
      </div>

      {preview && !result && (
        <div className="panel">
          <h3>Preview <span className="hint">— nothing written yet</span></h3>
          <Stats stats={preview.stats} />
          {preview.headers && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table>
                <thead><tr>{preview.headers.slice(0, 8).map((h: string) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {(preview.previewRows ?? []).map((row: any, i: number) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      {preview.headers.slice(0, 8).map((h: string) => <td key={h} className="muted">{String(row[h] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="panel">
          <h3>Upload complete</h3>
          {result.dryRun && <div style={{ color: 'var(--warn)', marginBottom: 8 }}>Dry run — Airtable not configured, nothing was written.</div>}
          <Stats stats={result.stats} />
          {result.write && (
            <div className="cards" style={{ marginTop: 12 }}>
              {Object.entries(result.write).map(([k, v]) => (
                <div className="card" key={k}><div className="label">{k}</div><div className="value">{String(v)}</div></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stats({ stats }: { stats: any }) {
  if (!stats) return null;
  return (
    <div className="cards">
      {Object.entries(stats).map(([k, v]) => (
        <div className="card" key={k}>
          <div className="label">{k}</div>
          <div className="value">{typeof v === 'object' ? Object.keys(v as any).length : String(v)}</div>
        </div>
      ))}
    </div>
  );
}
