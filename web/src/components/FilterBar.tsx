import { useSearchParams } from 'react-router-dom';
import type { Filters } from '../api.ts';

const ROLES = ['SDR', 'SDR Manager', 'Other'];
const GEOS = ['US', 'Europe', 'ROW', 'Unknown'];
const SOURCES = ['Referral', 'LinkedIn', 'Job Board', 'Sourced', 'Direct', 'Other'];
const STATUSES = ['Active', 'Offered', 'Hired', 'Joined', 'Rejected', 'Withdrawn', 'Backout'];

const DERIVED_STAGES = ['Applied', 'Recruiter Screening', 'CV Review', 'Round 1', 'Round 2', 'Round 3', 'Cultural Round', 'Offer', 'Accepted', 'Rejected'];
const KEYS = ['scope', 'geo', 'role', 'source', 'status', 'stage', 'dateFrom', 'dateTo'] as const;

/** Read the shared global filters from the URL query string. */
export function useFilters(): Filters {
  const [sp] = useSearchParams();
  const f: Filters = { scope: sp.get('scope') ?? 'in' };
  for (const k of KEYS) {
    if (k === 'scope') continue;
    const v = sp.get(k);
    if (v) f[k] = v;
  }
  return f;
}

/** Global filter bar — writes to the URL so filters carry across views. */
export default function FilterBar({ showDates = true }: { showDates?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const get = (k: string, dflt = '') => sp.get(k) ?? dflt;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    setSp(next, { replace: true });
  };
  const reset = () => {
    const next = new URLSearchParams();
    next.set('scope', 'in');
    setSp(next, { replace: true });
  };

  const Sel = ({ k, label, opts, allLabel = 'All' }: { k: string; label: string; opts: string[]; allLabel?: string }) => (
    <div>
      <label>{label}</label>
      <select value={get(k)} onChange={(e) => set(k, e.target.value)}>
        <option value="">{allLabel}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="filters">
      <div>
        <label>Scope</label>
        <select value={get('scope', 'in')} onChange={(e) => set('scope', e.target.value)}>
          <option value="in">In scope (SDR)</option>
          <option value="all">All roles</option>
        </select>
      </div>
      <Sel k="geo" label="Geo" opts={GEOS} />
      <Sel k="role" label="Role" opts={ROLES} />
      <Sel k="source" label="Source" opts={SOURCES} />
      <Sel k="status" label="Status" opts={STATUSES} />
      <Sel k="stage" label="Stage" opts={DERIVED_STAGES} />
      {showDates && (
        <>
          <div>
            <label>Applied from</label>
            <input type="date" value={get('dateFrom')} onChange={(e) => set('dateFrom', e.target.value)} />
          </div>
          <div>
            <label>to</label>
            <input type="date" value={get('dateTo')} onChange={(e) => set('dateTo', e.target.value)} />
          </div>
        </>
      )}
      <button className="secondary" onClick={reset} style={{ marginLeft: 'auto' }}>Reset</button>
    </div>
  );
}
