import { useEffect, useMemo, useState } from 'react';
import { fetchCandidates, updateCandidate, type Candidate } from '../api.ts';
import { useAuth } from '../auth.tsx';
import FilterBar, { useFilters } from '../components/FilterBar.tsx';

const STAGES = ['Sourced', 'Applied', 'Screening', 'Recruiter Screening', 'CV Review', 'Round 1', 'Round 2', 'Round 3', 'Cultural Round', 'Offer', 'Hired', 'Rejected', 'Withdrawn'];
const STATUSES = ['Active', 'Offered', 'Hired', 'Joined', 'Rejected', 'Withdrawn', 'Backout'];
const SOURCES = ['Referral', 'LinkedIn', 'Job Board', 'Sourced', 'Direct', 'Other'];

const COLUMNS: { key: string; label: string }[] = [
  { key: 'Name', label: 'Name' },
  { key: 'Geo', label: 'Geo' },
  { key: 'Derived Stage', label: 'Stage' },
  { key: 'Current Stage', label: 'Raw Stage' },
  { key: 'Status', label: 'Status' },
  { key: 'Grouped Source', label: 'Source' },
  { key: 'Source', label: 'Raw Source' },
  { key: 'Referrer', label: 'Referrer' },
  { key: 'Date Applied', label: 'Applied' },
];

export default function Candidates() {
  const filters = useFilters();
  const { isAdmin } = useAuth();
  const peekData = fetchCandidates.peek(filters);
  const [rows, setRows] = useState<Candidate[]>(peekData?.candidates ?? []);
  const [loading, setLoading] = useState(!peekData);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'Date Applied', dir: -1 });
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchCandidates(filters).then((d) => { setRows(d.candidates); setLoading(false); });
  }, [JSON.stringify(filters)]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = rows;
    if (needle) r = r.filter((c) => `${c.Name ?? ''} ${c.Email ?? ''}`.toLowerCase().includes(needle));
    return [...r].sort((a, b) => {
      const av = String(a[sort.key] ?? ''), bv = String(b[sort.key] ?? '');
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
  }, [rows, q, sort]);

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const onSaved = (updated: Candidate) => {
    setRows((rs) => rs.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setSelected(null);
    setToast('Saved to Airtable');
    setTimeout(() => setToast(''), 2000);
  };

  const exportCsv = () => {
    const cols = [...COLUMNS.map((c) => c.key), 'Email'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.join(',')];
    for (const r of view) lines.push(cols.map((c) => esc(r[c])).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'candidates.csv';
    a.click();
  };

  return (
    <div>
      <FilterBar />
      <div className="searchbar">
        <input type="text" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="count">{view.length} of {rows.length}</span>
        <button className="secondary" onClick={exportCsv}>Export CSV</button>
      </div>

      {loading ? (
        <div className="loading">Loading candidates…</div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} onClick={() => onSort(col.key)}>
                    {col.label}{sort.key === col.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((c) => (
                <tr key={c.id} onClick={() => isAdmin && setSelected(c)} style={{ cursor: isAdmin ? 'pointer' : 'default' }}>
                  <td>{c.Name}<div className="muted" style={{ fontSize: 11 }}>{c.Email}</div></td>
                  <td>{c.Geo}</td>
                  <td>{c['Derived Stage']}</td>
                  <td className="muted">{c['Current Stage']}</td>
                  <td>{c.Status && <span className={`badge b-${c.Status}`}>{c.Status}</span>}</td>
                  <td>{c['Grouped Source']}</td>
                  <td className="muted">{c.Source}</td>
                  <td className="muted">{c.Referrer}</td>
                  <td className="muted">{c['Date Applied']}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && isAdmin && <EditDrawer candidate={selected} onClose={() => setSelected(null)} onSaved={onSaved} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function EditDrawer({ candidate, onClose, onSaved }: { candidate: Candidate; onClose: () => void; onSaved: (c: Candidate) => void }) {
  const [form, setForm] = useState({
    'Current Stage': candidate['Current Stage'] ?? '',
    Status: candidate.Status ?? '',
    Geo: candidate.Geo ?? '',
    Source: candidate.Source ?? '',
    'In Scope': Boolean(candidate['In Scope']),
    'Current Title': candidate['Current Title'] ?? '',
    Company: candidate.Company ?? '',
    Location: candidate.Location ?? '',
    'Feedback / Notes': candidate['Feedback / Notes'] ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await updateCandidate(candidate.id, form);
      onSaved({ ...candidate, ...form });
    } catch (e: any) { setErr(String(e.message)); setSaving(false); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <h2>{candidate.Name}</h2>
        <div className="email">{candidate.Email}</div>

        <Sel label="Stage" value={form['Current Stage']} opts={STAGES} onChange={(v) => set('Current Stage', v)} />
        <Sel label="Status" value={form.Status} opts={STATUSES} onChange={(v) => set('Status', v)} />
        <Sel label="Geo" value={form.Geo} opts={['US', 'Europe', 'ROW', 'Unknown']} onChange={(v) => set('Geo', v)} />
        <Sel label="Source" value={form.Source} opts={SOURCES} onChange={(v) => set('Source', v)} />
        <div className="field">
          <label><input type="checkbox" checked={form['In Scope']} onChange={(e) => set('In Scope', e.target.checked)} /> In scope</label>
        </div>
        <Txt label="Current title" value={form['Current Title']} onChange={(v) => set('Current Title', v)} />
        <Txt label="Company" value={form.Company} onChange={(v) => set('Company', v)} />
        <Txt label="Location" value={form.Location} onChange={(v) => set('Location', v)} />
        <div className="field">
          <label>Feedback / Notes</label>
          <textarea rows={3} style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: 8 }}
            value={form['Feedback / Notes']} onChange={(e) => set('Feedback / Notes', e.target.value)} />
        </div>

        {err && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
        <div className="drawer-actions">
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}

function Sel({ label, value, opts, onChange }: { label: string; value: string; opts: string[]; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Txt({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
