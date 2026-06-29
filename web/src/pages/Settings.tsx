import { useEffect, useState } from 'react';
import { fetchSourceGroups, saveSourceGroups, type SourceGroupConfig } from '../api.ts';

interface GroupEntry {
  name: string;
  rawValues: string[];
}

function toEntries(cfg: SourceGroupConfig): GroupEntry[] {
  return Object.entries(cfg.groups).map(([name, rawValues]) => ({ name, rawValues: [...rawValues] }));
}

function toConfig(entries: GroupEntry[]): SourceGroupConfig {
  const groups: Record<string, string[]> = {};
  for (const e of entries) {
    const name = e.name.trim();
    if (name) groups[name] = e.rawValues.filter((v) => v.trim());
  }
  return { groups };
}

export default function Settings() {
  const [entries, setEntries] = useState<GroupEntry[]>([]);
  const [saved, setSaved] = useState<GroupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [newRaw, setNewRaw] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchSourceGroups()
      .then((cfg) => {
        const e = toEntries(cfg);
        setEntries(e);
        setSaved(JSON.parse(JSON.stringify(e)));
      })
      .catch(() => setMsg('Failed to load config'))
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(entries) !== JSON.stringify(saved);

  const updateEntry = (idx: number, fn: (e: GroupEntry) => GroupEntry) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? fn({ ...e, rawValues: [...e.rawValues] }) : e)));
    setMsg('');
  };

  const addGroup = () => {
    setEntries((prev) => [...prev, { name: '', rawValues: [] }]);
    setMsg('');
  };

  const removeGroup = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    setMsg('');
  };

  const addRawValue = (idx: number) => {
    const val = (newRaw[idx] ?? '').trim();
    if (!val) return;
    updateEntry(idx, (e) => {
      if (!e.rawValues.includes(val)) e.rawValues.push(val);
      return e;
    });
    setNewRaw((prev) => ({ ...prev, [idx]: '' }));
  };

  const removeRawValue = (groupIdx: number, valIdx: number) => {
    updateEntry(groupIdx, (e) => {
      e.rawValues.splice(valIdx, 1);
      return e;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const cfg = toConfig(entries);
      await saveSourceGroups(cfg);
      const e = toEntries(cfg);
      setEntries(e);
      setSaved(JSON.parse(JSON.stringify(e)));
      setMsg('Saved');
    } catch (err: any) {
      setMsg(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEntries(JSON.parse(JSON.stringify(saved)));
    setMsg('');
  };

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div>
      <div className="panel">
        <h3>Source Grouping</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Map raw Airtable source values into display groups. The dashboard, pivot tables, and funnels will
          show the group name instead of individual raw values. Raw data in Airtable is never modified.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map((entry, gi) => (
            <div key={gi} className="source-group-card">
              <div className="source-group-header">
                <input
                  className="source-group-name"
                  value={entry.name}
                  placeholder="Group name"
                  onChange={(e) => updateEntry(gi, (en) => ({ ...en, name: e.target.value }))}
                />
                <button className="secondary source-group-remove" onClick={() => removeGroup(gi)} title="Remove group">
                  &times;
                </button>
              </div>

              <div className="source-group-tags">
                {entry.rawValues.map((val, vi) => (
                  <span key={vi} className="source-tag">
                    {val}
                    <button className="source-tag-x" onClick={() => removeRawValue(gi, vi)}>&times;</button>
                  </span>
                ))}
              </div>

              <div className="source-group-add">
                <input
                  placeholder="Add raw value…"
                  value={newRaw[gi] ?? ''}
                  onChange={(e) => setNewRaw((prev) => ({ ...prev, [gi]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRawValue(gi); } }}
                />
                <button className="secondary" onClick={() => addRawValue(gi)} style={{ fontSize: 12, padding: '4px 10px' }}>
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="secondary" onClick={addGroup} style={{ fontSize: 12 }}>+ Add group</button>
        </div>

        <div className="drawer-actions" style={{ marginTop: 18 }}>
          <button onClick={handleSave} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="secondary" onClick={handleReset} disabled={!dirty}>Reset</button>
          {msg && (
            <span style={{ fontSize: 13, color: msg === 'Saved' ? 'var(--good)' : 'var(--danger)', alignSelf: 'center' }}>
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
