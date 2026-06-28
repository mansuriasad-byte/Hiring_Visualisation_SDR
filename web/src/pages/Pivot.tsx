import { useEffect, useState } from 'react';
import {
  fetchPivot, type PivotResponse, type WeekSourceTable,
  type SourceFunnelRow, type VelocityRow, type InterviewerLoadData,
} from '../api.ts';

export default function Pivot() {
  const [geo, setGeo] = useState<string>('');
  const [data, setData] = useState<PivotResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    setData(null);
    fetchPivot(geo || undefined).then(setData).catch((e) => setErr(String(e.message)));
  }, [geo]);

  return (
    <div>
      <div className="filters">
        <div>
          <label>Geo</label>
          <select value={geo} onChange={(e) => setGeo(e.target.value)}>
            <option value="">All (SDR)</option>
            <option value="US">SDR — US</option>
            <option value="Europe">SDR — Europe</option>
          </select>
        </div>
      </div>

      {err && <div className="loading">Error: {err}</div>}
      {!err && !data && <div className="loading">Loading pipeline data…</div>}
      {data && (
        <>
          <div className="muted" style={{ marginBottom: 16 }}>
            {data.candidateCount} candidates · {data.interviewCount} in-scope interviews · {data.geo}
          </div>

          {/* Source conversion funnel */}
          <FunnelTable rows={data.sourceFunnel} />

          {/* Velocity */}
          <VelocityTable rows={data.velocity} />

          {/* Week × Source per stage */}
          {data.weekSourceTables.map((t) => (
            <WeekSource key={t.id} t={t} />
          ))}

          {/* Interviewer load */}
          <InterviewerLoad data={data.interviewerLoad} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Source conversion funnel                                            */
/* ------------------------------------------------------------------ */
function FunnelTable({ rows }: { rows: SourceFunnelRow[] }) {
  const csvExport = () => {
    const hdr = 'Source,Applications,R1,App→R1%,R2,R1→R2%,Offer,R2→Offer%,Accepted,Offer→Accept%,App→Accept%';
    const lines = [hdr, ...rows.map((r) =>
      [r.source, r.applications, r.r1, r.appToR1 + '%', r.r2, r.r1ToR2 + '%', r.offers, r.r2ToOffer + '%', r.accepted, r.offerToAccept + '%', r.overall + '%'].join(',')
    )];
    dl('source-funnel.csv', lines.join('\n'));
  };

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px 0' }}>
        <h3 style={{ margin: 0 }}>Source conversion funnel</h3>
        <button className="secondary" onClick={csvExport}>Export</button>
      </div>
      <table className="pivot">
        <thead>
          <tr>
            <th>Source</th>
            <th className="r">Applications</th>
            <th className="r">R1</th><th className="r pct">App→R1</th>
            <th className="r">R2</th><th className="r pct">R1→R2</th>
            <th className="r">Offer</th><th className="r pct">R2→Offer</th>
            <th className="r">Accepted</th><th className="r pct">Offer→Accept</th>
            <th className="r pct">Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isTotal = r.source === 'Grand Total';
            const s: React.CSSProperties = isTotal ? { fontWeight: 700, borderTop: '2px solid var(--border)' } : {};
            return (
              <tr key={r.source} style={{ cursor: 'default' }}>
                <td style={s}>{r.source}</td>
                <td className="r" style={s}>{r.applications}</td>
                <td className="r" style={s}>{r.r1}</td><td className="r pct" style={s}>{r.appToR1}%</td>
                <td className="r" style={s}>{r.r2}</td><td className="r pct" style={s}>{r.r1ToR2}%</td>
                <td className="r" style={s}>{r.offers}</td><td className="r pct" style={s}>{r.r2ToOffer}%</td>
                <td className="r" style={s}>{r.accepted}</td><td className="r pct" style={s}>{r.offerToAccept}%</td>
                <td className="r pct" style={s}>{r.overall}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Velocity (avg days between stages)                                 */
/* ------------------------------------------------------------------ */
function VelocityTable({ rows }: { rows: VelocityRow[] }) {
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3>Pipeline velocity <span className="hint">— average & median days between stages</span></h3>
      <div className="cards">
        {rows.map((r) => (
          <div className="card" key={r.transition}>
            <div className="label">{r.transition}</div>
            <div className="value">{r.avg !== null ? `${r.avg}d` : '—'}</div>
            <div className="sub">
              {r.median !== null ? `median ${r.median}d` : ''}{r.count ? ` · ${r.count} candidates` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week × Source table (one per stage)                                 */
/* ------------------------------------------------------------------ */
function WeekSource({ t }: { t: WeekSourceTable }) {
  const max = Math.max(1, ...t.rows.flatMap((r) => t.cols.map((c) => r.cells[c] ?? 0)));
  const shade = (n: number) => (n ? `rgba(91,140,255,${0.12 + 0.55 * (n / max)})` : 'transparent');

  const csvExport = () => {
    const hdr = ['Week', ...t.cols, 'Total'].join(',');
    const lines = [hdr, ...t.rows.map((r) =>
      [r.week, ...t.cols.map((c) => r.cells[c] ?? 0), r.total].join(',')
    ), ['Total', ...t.cols.map((c) => t.colTotals[c] ?? 0), t.grandTotal].join(',')];
    dl(`${t.id}.csv`, lines.join('\n'));
  };

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px 0' }}>
        <h3 style={{ margin: 0 }}>{t.title} <span className="hint">by week × source</span></h3>
        <button className="secondary" onClick={csvExport}>Export</button>
      </div>
      <table className="pivot">
        <thead>
          <tr>
            <th>Week</th>
            {t.cols.map((c) => <th key={c} className="r">{c}</th>)}
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.filter((r) => r.total > 0).map((r) => (
            <tr key={r.week} style={{ cursor: 'default' }}>
              <td>{r.week}</td>
              {t.cols.map((c) => {
                const n = r.cells[c] ?? 0;
                return <td key={c} className="r" style={{ background: shade(n) }}>{n || ''}</td>;
              })}
              <td className="r" style={{ fontWeight: 700 }}>{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ fontWeight: 700 }}>Total</td>
            {t.cols.map((c) => <td key={c} className="r" style={{ fontWeight: 700 }}>{t.colTotals[c] ?? 0}</td>)}
            <td className="r" style={{ fontWeight: 700 }}>{t.grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Interviewer load by week                                           */
/* ------------------------------------------------------------------ */
function InterviewerLoad({ data }: { data: InterviewerLoadData }) {
  if (!data.rows.length) return null;
  const max = Math.max(1, ...data.rows.flatMap((r) => data.weeks.map((w) => r.cells[w] ?? 0)));
  const shade = (n: number) => (n ? `rgba(54,198,146,${0.15 + 0.55 * (n / max)})` : 'transparent');

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
      <h3 style={{ padding: '14px 16px 0', margin: 0 }}>Interviewer load <span className="hint">— interviews per week</span></h3>
      <table className="pivot">
        <thead>
          <tr>
            <th>Interviewer</th>
            {data.weeks.map((w) => <th key={w} className="r">{w}</th>)}
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.interviewer} style={{ cursor: 'default' }}>
              <td>{r.interviewer}</td>
              {data.weeks.map((w) => {
                const n = r.cells[w] ?? 0;
                return <td key={w} className="r" style={{ background: shade(n) }}>{n || ''}</td>;
              })}
              <td className="r" style={{ fontWeight: 700 }}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function dl(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
