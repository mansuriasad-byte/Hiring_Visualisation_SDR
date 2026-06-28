import { useEffect, useState, useMemo } from 'react';
import {
  fetchPivot, type PivotResponse, type WeekSourceTable,
  type SourceFunnelRow, type VelocityRow, type InterviewerLoadData,
} from '../api.ts';

type SortDir = 'asc' | 'desc';
type SortState<K extends string = string> = { col: K; dir: SortDir } | null;

function toggle<K extends string>(prev: SortState<K>, col: K): SortState<K> {
  if (prev?.col === col) return prev.dir === 'asc' ? { col, dir: 'desc' } : null;
  return { col, dir: 'asc' };
}

function arrow(active: boolean, dir: SortDir) {
  if (!active) return ' ↕';
  return dir === 'asc' ? ' ↑' : ' ↓';
}

export default function Pivot() {
  const [geo, setGeo] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [data, setData] = useState<PivotResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setErr('');
    setData(null);
    fetchPivot({
      geo: geo || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }).then(setData).catch((e) => setErr(String(e.message)));
  }, [geo, dateFrom, dateTo]);

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
        <div>
          <label>From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label>To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button className="secondary" onClick={() => { setGeo(''); setDateFrom(''); setDateTo(''); }} style={{ marginLeft: 'auto' }}>Reset</button>
      </div>

      {err && <div className="loading">Error: {err}</div>}
      {!err && !data && <div className="loading">Loading pipeline data…</div>}
      {data && (
        <>
          <div className="muted" style={{ marginBottom: 16 }}>
            {data.candidateCount} candidates · {data.interviewCount} in-scope interviews · {data.geo}
          </div>

          <FunnelTable rows={data.sourceFunnel} />
          <VelocityTable rows={data.velocity} />
          {data.weekSourceTables.map((t) => (
            <WeekSource key={t.id} t={t} />
          ))}
          <InterviewerLoad data={data.interviewerLoad} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sortable header                                                     */
/* ------------------------------------------------------------------ */
function Th({ col, sort, onSort, className, children }: {
  col: string; sort: SortState; onSort: (col: string) => void;
  className?: string; children: React.ReactNode;
}) {
  const active = sort?.col === col;
  return (
    <th className={className} onClick={() => onSort(col)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {children}<span className="sort-arrow" style={{ opacity: active ? 1 : 0.3, fontSize: 11 }}>{arrow(active, sort?.dir ?? 'asc')}</span>
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Source conversion funnel                                            */
/* ------------------------------------------------------------------ */
type FunnelCol = 'source' | 'applications' | 'r1' | 'appToR1' | 'r2' | 'r1ToR2' | 'offers' | 'r2ToOffer' | 'accepted' | 'offerToAccept' | 'overall';

function FunnelTable({ rows }: { rows: SourceFunnelRow[] }) {
  const [sort, setSort] = useState<SortState<FunnelCol>>(null);

  const sorted = useMemo(() => {
    const data = rows.filter((r) => r.source !== 'Grand Total');
    const total = rows.find((r) => r.source === 'Grand Total');
    if (!sort) return [...data, ...(total ? [total] : [])];
    const s = [...data].sort((a, b) => {
      const av = a[sort.col], bv = b[sort.col];
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return [...s, ...(total ? [total] : [])];
  }, [rows, sort]);

  const csvExport = () => {
    const hdr = 'Source,Applications,R1,App→R1%,R2,R1→R2%,Offer,R2→Offer%,Accepted,Offer→Accept%,App→Accept%';
    const lines = [hdr, ...rows.map((r) =>
      [r.source, r.applications, r.r1, r.appToR1 + '%', r.r2, r.r1ToR2 + '%', r.offers, r.r2ToOffer + '%', r.accepted, r.offerToAccept + '%', r.overall + '%'].join(',')
    )];
    dl('source-funnel.csv', lines.join('\n'));
  };

  const onSort = (col: string) => setSort((s) => toggle(s, col as FunnelCol));

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px 0' }}>
        <h3 style={{ margin: 0 }}>Source conversion funnel</h3>
        <button className="secondary" onClick={csvExport}>Export</button>
      </div>
      <table className="pivot">
        <thead>
          <tr>
            <Th col="source" sort={sort} onSort={onSort}>Source</Th>
            <Th col="applications" sort={sort} onSort={onSort} className="r">Applications</Th>
            <Th col="r1" sort={sort} onSort={onSort} className="r">R1</Th>
            <Th col="appToR1" sort={sort} onSort={onSort} className="r pct">App→R1</Th>
            <Th col="r2" sort={sort} onSort={onSort} className="r">R2</Th>
            <Th col="r1ToR2" sort={sort} onSort={onSort} className="r pct">R1→R2</Th>
            <Th col="offers" sort={sort} onSort={onSort} className="r">Offer</Th>
            <Th col="r2ToOffer" sort={sort} onSort={onSort} className="r pct">R2→Offer</Th>
            <Th col="accepted" sort={sort} onSort={onSort} className="r">Accepted</Th>
            <Th col="offerToAccept" sort={sort} onSort={onSort} className="r pct">Offer→Accept</Th>
            <Th col="overall" sort={sort} onSort={onSort} className="r pct">Overall</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
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
/* Velocity                                                            */
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
  const [sort, setSort] = useState<SortState>(null);
  const max = Math.max(1, ...t.rows.flatMap((r) => t.cols.map((c) => r.cells[c] ?? 0)));
  const shade = (n: number) => (n ? `rgba(91,140,255,${0.12 + 0.55 * (n / max)})` : 'transparent');

  const sorted = useMemo(() => {
    const visible = t.rows.filter((r) => r.total > 0);
    if (!sort) return visible;
    return [...visible].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sort.col === 'week') { av = a.week; bv = b.week; }
      else if (sort.col === 'total') { av = a.total; bv = b.total; }
      else { av = a.cells[sort.col] ?? 0; bv = b.cells[sort.col] ?? 0; }
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sort.dir === 'asc' ? av - (bv as number) : (bv as number) - av;
    });
  }, [t.rows, t.cols, sort]);

  const onSort = (col: string) => setSort((s) => toggle(s, col));

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
            <Th col="week" sort={sort} onSort={onSort}>Week</Th>
            {t.cols.map((c) => <Th key={c} col={c} sort={sort} onSort={onSort} className="r">{c}</Th>)}
            <Th col="total" sort={sort} onSort={onSort} className="r">Total</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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
  const [sort, setSort] = useState<SortState>(null);
  const max = Math.max(1, ...data.rows.flatMap((r) => data.weeks.map((w) => r.cells[w] ?? 0)));

  const sorted = useMemo(() => {
    if (!sort) return data.rows;
    return [...data.rows].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sort.col === 'interviewer') { av = a.interviewer; bv = b.interviewer; }
      else if (sort.col === 'total') { av = a.total; bv = b.total; }
      else { av = a.cells[sort.col] ?? 0; bv = b.cells[sort.col] ?? 0; }
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sort.dir === 'asc' ? av - (bv as number) : (bv as number) - av;
    });
  }, [data.rows, data.weeks, sort]);

  const onSort = (col: string) => setSort((s) => toggle(s, col));
  const shade = (n: number) => (n ? `rgba(54,198,146,${0.15 + 0.55 * (n / max)})` : 'transparent');

  if (!data.rows.length) return null;

  return (
    <div className="panel" style={{ padding: 0, marginBottom: 18, overflowX: 'auto' }}>
      <h3 style={{ padding: '14px 16px 0', margin: 0 }}>Interviewer load <span className="hint">— interviews per week</span></h3>
      <table className="pivot">
        <thead>
          <tr>
            <Th col="interviewer" sort={sort} onSort={onSort}>Interviewer</Th>
            {data.weeks.map((w) => <Th key={w} col={w} sort={sort} onSort={onSort} className="r">{w}</Th>)}
            <Th col="total" sort={sort} onSort={onSort} className="r">Total</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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
