import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { fetchMetrics, type Metrics } from '../api.ts';
import FilterBar, { useFilters } from '../components/FilterBar.tsx';

const STATUS_COLORS: Record<string, string> = {
  Active: '#5b8cff', Hired: '#36c692', Joined: '#36c692',
  Rejected: '#ff6b6b', Backout: '#f7b955', Withdrawn: '#f7b955', Offered: '#b69bff',
};
const SOURCE_COLOR = '#5b8cff';

export default function Dashboard() {
  const filters = useFilters();
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    fetchMetrics(filters).then(setM).catch((e) => setErr(String(e.message)));
  }, [JSON.stringify(filters)]);

  if (err) return <div><FilterBar /><div className="loading">Error: {err}</div></div>;
  if (!m) return <div><FilterBar /><div className="loading">Loading metrics…</div></div>;

  const c = m.candidates;
  const topFunnel = c.funnel[0]?.reached || 1;
  const toRows = (rec: Record<string, number>) =>
    Object.entries(rec).filter(([k]) => k !== 'Unknown').map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  const statusRows = toRows(c.byStatus);
  const sourceRows = toRows(c.bySource);

  return (
    <div>
      <FilterBar />

      <div className="cards">
        <Stat label="Candidates" value={c.total} sub={`${m.filters.scope === 'in' ? 'in scope' : 'all'}`} />
        <Stat label="Active" value={c.byStatus.Active ?? 0} />
        <Stat label="Hired" value={c.byStatus.Hired ?? 0} />
        <Stat label="Rejected" value={c.byStatus.Rejected ?? 0} />
        <Stat label="Interviews matched" value={`${m.interviews.matched}`} sub={`of ${m.interviews.total}`} />
        <Stat label="Need review" value={m.interviews.needsReview} sub="interviews" />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>Pipeline funnel <span className="hint">— candidates reaching each stage ({c.funnelUnplaced} rejected at unknown stage, not shown)</span></h3>
          {c.funnel.map((f) => (
            <div className="funnel-row" key={f.stage}>
              <div className="name">{f.stage}</div>
              <div className="bar" style={{ width: `${Math.max((f.reached / topFunnel) * 100, 1)}%` }} />
              <div className="n">{f.reached}</div>
              <div className="pct">{topFunnel ? Math.round((f.reached / topFunnel) * 100) : 0}%</div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>By status</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusRows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                {statusRows.map((r) => (
                  <Cell key={r.name} fill={STATUS_COLORS[r.name] ?? '#888'} />
                ))}
              </Pie>
              <Legend />
              <Tooltip contentStyle={{ background: '#1f2330', border: '1px solid #2a2f3d', borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>By source</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sourceRows} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" stroke="#9aa3b2" />
              <YAxis type="category" dataKey="name" stroke="#9aa3b2" width={90} />
              <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ background: '#1f2330', border: '1px solid #2a2f3d', borderRadius: 8 }} />
              <Bar dataKey="value" fill={SOURCE_COLOR} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>Interviews by round <span className="hint">(in-scope: {m.interviews.inScope})</span></h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={toRows(m.interviews.byRound)} margin={{ left: 0 }}>
              <XAxis dataKey="name" stroke="#9aa3b2" fontSize={11} />
              <YAxis stroke="#9aa3b2" />
              <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={{ background: '#1f2330', border: '1px solid #2a2f3d', borderRadius: 8 }} />
              <Bar dataKey="value" fill="#36c692" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
