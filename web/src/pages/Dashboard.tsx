import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from 'recharts';
import { fetchMetrics, fetchPivot, type Metrics, type PivotResponse } from '../api.ts';
import FilterBar, { useFilters } from '../components/FilterBar.tsx';

const ACTIVE_STAGE_ORDER = [
  'Sourced', 'Applied', 'Recruiter Screening', 'CV Review',
  'Round 1', 'Round 2', 'Round 3', 'Cultural Round', 'Offer',
];

const STAGE_LABEL: Record<string, string> = { 'Hired': 'Accepted' };
const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;

const SOURCE_COLOR = '#5b8cff';
const ACCENT = '#36c692';
const WARN = '#f7b955';

const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

const tooltipStyle = { background: '#1f2330', border: '1px solid #2a2f3d', borderRadius: 8 };

export default function Dashboard() {
  const filters = useFilters();
  const [m, setM] = useState<Metrics | null>(() => fetchMetrics.peek(filters) ?? null);
  const [pivot, setPivot] = useState<PivotResponse | null>(() => fetchPivot.peek({ geo: filters.geo, dateFrom: filters.dateFrom, dateTo: filters.dateTo }) ?? null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    fetchMetrics(filters).then(setM).catch((e) => setErr(String(e.message)));
  }, [JSON.stringify(filters)]);

  useEffect(() => {
    fetchPivot({ geo: filters.geo, dateFrom: filters.dateFrom, dateTo: filters.dateTo })
      .then(setPivot).catch(() => {});
  }, [filters.geo, filters.dateFrom, filters.dateTo]);

  if (err) return <div><FilterBar /><div className="loading">Error: {err}</div></div>;
  if (!m) return <div><FilterBar /><div className="loading">Loading metrics…</div></div>;

  const c = m.candidates;
  const reached = (stage: string) => c.funnel?.find((f) => f.stage === stage)?.reached ?? 0;

  // Active pipeline
  const ap = c.activePipeline ?? {};
  const activePipeline = ACTIVE_STAGE_ORDER
    .map((stage) => ({ name: stage, count: ap[stage] ?? 0 }))
    .filter((r) => r.count > 0);

  // Conversion rates
  const convPairs: [string, string][] = [
    ['Applied', 'Round 1'], ['Round 1', 'Round 2'], ['Round 2', 'Round 3'],
    ['Round 3', 'Cultural Round'], ['Cultural Round', 'Offer'], ['Offer', 'Hired'],
  ];
  const conversions = convPairs.map(([from, to]) => ({
    label: `${stageLabel(from)} → ${stageLabel(to)}`,
    rate: pct(reached(to), reached(from)),
    from: reached(from),
    to: reached(to),
  }));

  // Source bar chart
  const sourceRows = Object.entries(c.bySource)
    .filter(([k]) => k !== 'Unknown')
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Interviews by round
  const roundRows = Object.entries(m.interviews.byRound)
    .map(([name, value]) => ({ name, value }));

  // Weekly inflow from pivot
  const weeklyInflow = pivot?.weekSourceTables[0]?.rows.map((r) => ({
    week: r.week.replace(/^(\w+)\s(\d+)$/, '$1 $2'),
    count: r.total,
  })) ?? [];

  // Velocity from pivot
  const velocity = pivot?.velocity ?? [];

  // Source effectiveness from pivot
  const srcFunnel = pivot?.sourceFunnel.filter((r) => r.source !== 'Grand Total') ?? [];

  // Hiring pace: offers by week from pivot
  const offersTable = pivot?.weekSourceTables[4];
  const hiringPace = offersTable?.rows
    .map((r) => ({ week: r.week.replace(/^(\w+)\s(\d+)$/, '$1 $2'), offers: r.total }))
    .filter((r) => r.offers > 0) ?? [];

  return (
    <div>
      <FilterBar />

      {/* KPI Cards */}
      <div className="cards">
        <Stat label="Total Candidates" value={c.total} />
        <Stat label="R1" value={reached('Round 1')} sub="reached" />
        <Stat label="R2" value={reached('Round 2')} sub="reached" />
        <Stat label="R3" value={reached('Round 3')} sub="reached" />
        <Stat label="Offers" value={reached('Offer')} />
        <Stat label="Accepted" value={reached('Hired')} />
      </div>

      {/* Active Pipeline + Conversion Rates */}
      <div className="grid-2">
        <div className="panel">
          <h3>Active pipeline <span className="hint">— {activePipeline.reduce((s, r) => s + r.count, 0)} active candidates by current stage</span></h3>
          <ResponsiveContainer width="100%" height={Math.max(activePipeline.length * 36, 120)}>
            <BarChart data={activePipeline} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" stroke="#9aa3b2" />
              <YAxis type="category" dataKey="name" stroke="#9aa3b2" width={130} fontSize={12} />
              <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>Stage conversion rates</h3>
          <div className="conversion-list">
            {conversions.map((cv) => (
              <div className="conversion-row" key={cv.label}>
                <div className="conv-label">{cv.label}</div>
                <div className="conv-bar-track">
                  <div
                    className="conv-bar-fill"
                    style={{ width: `${Math.min(cv.rate, 100)}%`, background: cv.rate > 50 ? ACCENT : cv.rate > 20 ? WARN : '#ff6b6b' }}
                  />
                </div>
                <div className="conv-pct">{cv.rate}%</div>
                <div className="conv-detail">{cv.to}/{cv.from}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly Inflow + Hiring Pace */}
      <div className="grid-2">
        <div className="panel">
          <h3>Weekly inflow <span className="hint">— new applications per week</span></h3>
          {weeklyInflow.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={weeklyInflow} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3d" />
                <XAxis dataKey="week" stroke="#9aa3b2" fontSize={10} interval={Math.max(0, Math.floor(weeklyInflow.length / 8))} angle={-30} textAnchor="end" height={50} />
                <YAxis stroke="#9aa3b2" />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="count" stroke={SOURCE_COLOR} fill={SOURCE_COLOR} fillOpacity={0.2} name="Applications" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="muted">No pivot data loaded</div>}
        </div>

        <div className="panel">
          <h3>Hiring pace <span className="hint">— offers per week</span></h3>
          {hiringPace.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hiringPace} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3d" />
                <XAxis dataKey="week" stroke="#9aa3b2" fontSize={10} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis stroke="#9aa3b2" allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="offers" fill={ACCENT} radius={[4, 4, 0, 0]} name="Offers" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="muted">No offer data</div>}
        </div>
      </div>

      {/* Source Volume + Source Effectiveness */}
      <div className="grid-2">
        <div className="panel">
          <h3>By source</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sourceRows} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" stroke="#9aa3b2" />
              <YAxis type="category" dataKey="name" stroke="#9aa3b2" width={90} />
              <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill={SOURCE_COLOR} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h3>Source effectiveness <span className="hint">— conversion by source</span></h3>
          {srcFunnel.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Source</th><th>Applied</th><th>R1</th><th>R2</th><th>R3</th><th>Offers</th>
                    <th>App→R1</th><th>Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {srcFunnel.map((r) => (
                    <tr key={r.source}>
                      <td>{r.source}</td>
                      <td>{r.applications}</td><td>{r.r1}</td><td>{r.r2}</td><td>{r.r3}</td><td>{r.offers}</td>
                      <td className={r.appToR1 > 30 ? 'good' : r.appToR1 > 15 ? '' : 'warn'}>{r.appToR1}%</td>
                      <td className={r.overall > 5 ? 'good' : ''}>{r.overall}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="muted">No pivot data loaded</div>}
        </div>
      </div>

      {/* Velocity + Interviews by Round */}
      <div className="grid-2">
        <div className="panel">
          <h3>Pipeline velocity <span className="hint">— avg days between stages</span></h3>
          {velocity.length > 0 ? (
            <div className="velocity-list">
              {velocity.filter((v) => v.count > 0).map((v) => (
                <div className="velocity-row" key={v.transition}>
                  <div className="vel-label">{v.transition}</div>
                  <div className="vel-bar-track">
                    <div className="vel-bar-fill" style={{ width: `${Math.min((v.avg ?? 0) / 30 * 100, 100)}%` }} />
                  </div>
                  <div className="vel-avg">{v.avg ?? '—'}d avg</div>
                  <div className="vel-med">{v.median ?? '—'}d med</div>
                  <div className="vel-n">n={v.count}</div>
                </div>
              ))}
            </div>
          ) : <div className="muted">No velocity data</div>}
        </div>

        <div className="panel">
          <h3>Interviews by round</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={roundRows} margin={{ left: 0 }}>
              <XAxis dataKey="name" stroke="#9aa3b2" fontSize={11} />
              <YAxis stroke="#9aa3b2" />
              <Tooltip cursor={{ fill: '#ffffff10' }} contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill={ACCENT} radius={[4, 4, 0, 0]} />
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
