import { useState } from 'react';
import { uploadPreview, uploadCommit, type UploadType } from '../api.ts';

const TYPES: { value: UploadType; label: string; hint: string }[] = [
  { value: 'ats', label: 'ATS dump', hint: 'PyJaama per-role candidate export. Requires role + geo (the export has no role column).' },
  { value: 'referral', label: 'Referral dump', hint: 'Employee referral export (all roles). Role/geo parsed from Job Title; SDR US/Europe tagged in scope.' },
  { value: 'offer', label: 'Offer / join status', hint: 'Update-only: patches status + offer/join dates on existing candidates by email. Never creates.' },
];

const ROLES = ['SDR', 'SDR Manager', 'Other'];
const GEOS = ['US', 'Europe', 'ROW'];

const TEMPLATES: Partial<Record<UploadType, { filename: string; header: string; sample: string[] }>> = {
  offer: {
    filename: 'offer-template.csv',
    header: 'Candidate Name,Email,Offer Status,Offer Date,Join Date',
    sample: [
      'Priya Sharma,priya.sharma@gmail.com,Offered,6/15/2026,',
      'John Smith,john.smith@outlook.com,Joined,5/20/2026,6/25/2026',
      'Anika Patel,anika.p@yahoo.com,Declined,6/1/2026,',
    ],
  },
  ats: {
    filename: 'ats-template.csv',
    header: 'name,email,phone,pipeline,source,application_date,designation,company,current_ctc,expected_ctc,notice,experience,location,linkedin,skills,feedback_score',
    sample: [
      'Priya Sharma,priya.sharma@gmail.com,9876543210,Applied,LinkedIn,3/16/2026,SDR,Acme Corp,800000,1200000,30,2 years,Mumbai,https://linkedin.com/in/priya,Sales;CRM,4',
    ],
  },
  referral: {
    filename: 'referral-template.csv',
    header: 'Candidate Name,Candidate Email,Job Title,Referrer,TA Response,Applied Date',
    sample: [
      'John Smith,john.smith@gmail.com,Sales Development Representative- US,Jane Doe,Processing,Jun 10 2026',
    ],
  },
};

function downloadTemplate(type: UploadType) {
  const t = TEMPLATES[type];
  if (!t) return;
  const content = [t.header, ...t.sample].join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = t.filename;
  a.click();
}

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
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{t.hint}</div>
                </div>
                {TEMPLATES[t.value] && (
                  <button className="secondary" style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap', alignSelf: 'center' }}
                    onClick={(e) => { e.preventDefault(); downloadTemplate(t.value); }}>
                    Download template
                  </button>
                )}
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
          <Stats stats={result.stats} write={result.write} />
        </div>
      )}
    </div>
  );
}

const WRITE_LABELS: Record<string, string> = {
  created: 'Created', updated: 'Updated', skippedFlagged: 'Skipped (flagged)', unmatched: 'Unmatched',
};

function Stats({ stats, write }: { stats: any; write?: any }) {
  if (!stats) return null;
  const flagged: Record<string, number> = stats.flagged ?? {};
  const totalFlagged = Object.values(flagged).reduce((a: number, b: unknown) => a + (b as number), 0);
  const byRoleGeo: Record<string, number> = stats.byRoleGeo ?? {};

  return (
    <>
      <div className="cards">
        <div className="card"><div className="label">Total rows</div><div className="value">{stats.totalRows}</div></div>
        <div className="card"><div className="label">Parsed</div><div className="value">{stats.parsed}</div></div>
        <div className="card"><div className="label">In scope</div><div className="value">{stats.inScope}</div></div>
        <div className="card"><div className="label">Flagged</div><div className="value">{totalFlagged}</div></div>
      </div>

      {write && (
        <div className="cards" style={{ marginTop: 12 }}>
          {Object.entries(write).map(([k, v]) => (
            <div className="card" key={k}>
              <div className="label">{WRITE_LABELS[k] ?? k}</div>
              <div className="value">{String(v)}</div>
            </div>
          ))}
        </div>
      )}

      {totalFlagged > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Flagged breakdown</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            {flagged.test > 0 && <span className="muted">Test/junk names: <strong style={{ color: 'var(--text)' }}>{flagged.test}</strong></span>}
            {flagged.no_email > 0 && <span className="muted">Missing email: <strong style={{ color: 'var(--text)' }}>{flagged.no_email}</strong></span>}
            {flagged.bad_email > 0 && <span className="muted">Invalid email: <strong style={{ color: 'var(--text)' }}>{flagged.bad_email}</strong></span>}
          </div>
        </div>
      )}

      {Object.keys(byRoleGeo).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>By role / geo</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            {Object.entries(byRoleGeo).map(([k, v]) => (
              <span key={k} className="muted">{k}: <strong style={{ color: 'var(--text)' }}>{v}</strong></span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
