import { Router } from 'express';
import { listRecords, updateRecord, airtableConfigured, type AirtableRecord } from '../airtable/client.ts';
import { F } from '../airtable/schema.ts';
import { STAGE_ORDER } from '../services/normalize.ts';
import { requireAuth, requireAdmin } from '../auth/session.ts';

const router = Router();

const EDITABLE_CANDIDATE_FIELDS = new Set<string>([
  F.name, F.email, F.phone, F.role, F.geo, F.inScope, F.source,
  F.stage, F.status, F.currentTitle, F.company, F.location, F.feedbackDetails,
]);

const tally = (recs: AirtableRecord[], field: string) => {
  const m: Record<string, number> = {};
  for (const r of recs) {
    const v = r.fields[field];
    const key = v === undefined || v === '' ? 'Unknown' : String(v);
    m[key] = (m[key] ?? 0) + 1;
  }
  return m;
};

function filterCandidates(recs: AirtableRecord[], q: Record<string, unknown>): AirtableRecord[] {
  let out = recs;
  if (q.scope !== 'all') out = out.filter((r) => r.fields[F.inScope] === true);
  if (q.role) out = out.filter((r) => r.fields[F.role] === q.role);
  if (q.geo) out = out.filter((r) => r.fields[F.geo] === q.geo);
  if (q.source) out = out.filter((r) => r.fields[F.source] === q.source);
  if (q.status) out = out.filter((r) => r.fields[F.status] === q.status);
  if (q.dateFrom) out = out.filter((r) => String(r.fields[F.dateApplied] ?? '') >= String(q.dateFrom));
  if (q.dateTo) out = out.filter((r) => String(r.fields[F.dateApplied] ?? '9999') <= String(q.dateTo));
  return out;
}

function guard(res: any): boolean {
  if (!airtableConfigured()) {
    res.status(503).json({ error: 'Airtable not configured (set AIRTABLE_PAT / AIRTABLE_BASE_ID).' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers for the pipeline pivot
// ---------------------------------------------------------------------------

/** Monday-of-week label: "April 6", "May 11", etc. */
function weekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '(unknown)';
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  const mon = new Date(d);
  mon.setUTCDate(mon.getUTCDate() + diff);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[mon.getUTCMonth()]} ${mon.getUTCDate()}`;
}

/** Sortable week key: "2026-W15" style, used for ordering. */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '9999-W99';
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setUTCDate(mon.getUTCDate() + diff);
  const y = mon.getUTCFullYear();
  const jan1 = new Date(Date.UTC(y, 0, 1));
  const wn = Math.ceil(((mon.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return `${y}-W${String(wn).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number | null {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** Build a week×source count table from a list of {date, source} pairs. */
function weekSourceTable(
  entries: { date: string; source: string }[],
  allWeeks: { key: string; label: string }[],
) {
  const sources = new Set<string>();
  const map = new Map<string, Map<string, number>>(); // weekKey -> source -> count
  for (const { date, source } of entries) {
    const wk = weekKey(date);
    sources.add(source);
    const row = map.get(wk) ?? new Map();
    row.set(source, (row.get(source) ?? 0) + 1);
    map.set(wk, row);
  }
  const cols = [...sources].sort();
  const rows = allWeeks.map(({ key, label }) => {
    const row = map.get(key);
    const cells: Record<string, number> = {};
    let total = 0;
    for (const c of cols) { const n = row?.get(c) ?? 0; cells[c] = n; total += n; }
    return { week: label, cells, total };
  });
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  for (const c of cols) { const t = rows.reduce((s, r) => s + (r.cells[c] ?? 0), 0); colTotals[c] = t; grandTotal += t; }
  return { cols, rows, colTotals, grandTotal };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/candidates', requireAuth, async (req, res) => {
  if (!guard(res)) return;
  try {
    const recs = await listRecords('Candidates');
    const rows = filterCandidates(recs, req.query).map((r) => ({ id: r.id, ...r.fields }));
    res.json({ count: rows.length, candidates: rows });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.patch('/candidates/:id', requireAdmin, async (req, res) => {
  if (!guard(res)) return;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (EDITABLE_CANDIDATE_FIELDS.has(k)) fields[k] = v;
  }
  if (!Object.keys(fields).length) return res.status(422).json({ error: 'No editable fields in body.' });
  try {
    const rec = await updateRecord('Candidates', req.params.id, fields);
    res.json({ ok: true, id: rec.id, fields: rec.fields });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/interviews', requireAuth, async (req, res) => {
  if (!guard(res)) return;
  try {
    const recs = await listRecords('Interviews');
    let rows: Record<string, any>[] = recs.map((r) => ({ id: r.id, ...r.fields }));
    if (req.query.scope === 'in') rows = rows.filter((r) => r['In Scope'] === true);
    if (req.query.needsReview === '1') rows = rows.filter((r) => r['Needs Review'] === true);
    res.json({ count: rows.length, interviews: rows });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/metrics', requireAuth, async (req, res) => {
  if (!guard(res)) return;
  try {
    const [candRecs, ivRecs] = await Promise.all([
      listRecords('Candidates'),
      listRecords('Interviews', { fields: ['In Scope', 'Needs Review', 'Matched Candidate', 'Round', 'Geo', 'Confidence'] }),
    ]);
    const cand = filterCandidates(candRecs, req.query);
    const { scope, role, geo } = req.query;
    const byStage = tally(cand, F.stage);
    const FUNNEL = STAGE_ORDER.filter((s) => s !== 'Rejected');
    const fidx = (s: string) => FUNNEL.indexOf(s as (typeof FUNNEL)[number]);
    const funnel = FUNNEL.map((stage, floor) => ({
      stage,
      reached: cand.filter((r) => fidx(String(r.fields[F.stage] ?? '')) >= floor).length,
    }));
    const unplaced = cand.filter((r) => fidx(String(r.fields[F.stage] ?? '')) === -1).length;
    let iv = ivRecs;
    if (scope !== 'all') iv = iv.filter((r) => r.fields['In Scope'] === true);
    if (geo) iv = iv.filter((r) => r.fields['Geo'] === geo);
    res.json({
      filters: { scope: scope ?? 'in', role: role ?? null, geo: geo ?? null },
      candidates: { total: cand.length, byStage, byStatus: tally(cand, F.status), bySource: tally(cand, F.source), byGeo: tally(cand, F.geo), byRole: tally(cand, F.role), funnel, funnelUnplaced: unplaced },
      interviews: { total: iv.length, inScope: iv.filter((r) => r.fields['In Scope'] === true).length, matched: iv.filter((r) => r.fields['Matched Candidate'] === true).length, needsReview: iv.filter((r) => r.fields['Needs Review'] === true).length, byRound: tally(iv, 'Round') },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

/**
 * GET /api/data/pivot
 *
 * The real hiring pipeline pivot: joins Candidates (ATS) + Interviews (Calendar)
 * + Offer/Join data to produce:
 *   1. Week × Source tables for each stage (Applied, R1, R2, Offer, Joined)
 *   2. Source conversion funnel (Applications → R1 → R2 → Offer → Accept + rates)
 *   3. Average days between stages (Applied→R1, R1→R2, R2→Offer, Offer→Join)
 *   4. Interviewer load by week
 *
 * Filtered by geo (SDR-US / SDR-Europe). SDM excluded.
 */
router.get('/pivot', requireAuth, async (req, res) => {
  if (!guard(res)) return;
  try {
    const [candRecs, ivRecs] = await Promise.all([
      listRecords('Candidates'),
      listRecords('Interviews'),
    ]);

    // --- scope: SDR only, filter by geo + date range ---
    const geo = typeof req.query.geo === 'string' ? req.query.geo : undefined;
    const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;

    let cand = candRecs.filter((r) =>
      r.fields[F.inScope] === true && r.fields[F.role] === 'SDR',
    );
    if (geo) cand = cand.filter((r) => r.fields[F.geo] === geo);
    if (dateFrom) cand = cand.filter((r) => String(r.fields[F.dateApplied] ?? '') >= dateFrom);
    if (dateTo) cand = cand.filter((r) => String(r.fields[F.dateApplied] ?? '9999') <= dateTo);

    let iv = ivRecs.filter((r) =>
      r.fields['In Scope'] === true && r.fields['Role'] === 'SDR',
    );
    if (geo) iv = iv.filter((r) => r.fields['Geo'] === geo);
    if (dateFrom) iv = iv.filter((r) => String(r.fields['Interview Date'] ?? '') >= dateFrom);
    if (dateTo) iv = iv.filter((r) => String(r.fields['Interview Date'] ?? '9999') <= dateTo);

    // --- build candidate lookup by email ---
    const candByEmail = new Map<string, AirtableRecord>();
    for (const c of cand) {
      const email = String(c.fields[F.email] ?? '').toLowerCase();
      if (email) candByEmail.set(email, c);
    }

    // --- collect events per stage ---
    const applied: { date: string; source: string }[] = [];
    const r1: { date: string; source: string }[] = [];
    const r2: { date: string; source: string }[] = [];
    const offers: { date: string; source: string }[] = [];
    const joined: { date: string; source: string }[] = [];

    // Applied: from ATS (date applied)
    for (const c of cand) {
      const da = c.fields[F.dateApplied];
      if (da) applied.push({ date: String(da), source: String(c.fields[F.source] ?? 'Unknown') });
    }

    // R1 / R2: from Interviews (calendar). Join to candidate for source.
    for (const i of iv) {
      const round = String(i.fields['Round'] ?? '');
      const idate = String(i.fields['Interview Date'] ?? '');
      if (!idate) continue;
      const candEmail = String(i.fields['Candidate Email'] ?? '').toLowerCase();
      const candRec = candByEmail.get(candEmail);
      const source = candRec ? String(candRec.fields[F.source] ?? 'Unknown') : '(unmatched)';
      if (round === 'Round 1') r1.push({ date: idate, source });
      else if (round === 'Round 2') r2.push({ date: idate, source });
    }

    // Offers + Joined: from candidate records (offer/join dates)
    for (const c of cand) {
      const src = String(c.fields[F.source] ?? 'Unknown');
      if (c.fields[F.offerDate]) offers.push({ date: String(c.fields[F.offerDate]), source: src });
      if (c.fields[F.joinDate]) joined.push({ date: String(c.fields[F.joinDate]), source: src });
    }

    // --- determine all weeks (union across all stages) and sort ---
    const allWeekKeys = new Set<string>();
    const weekLabels = new Map<string, string>();
    for (const list of [applied, r1, r2, offers, joined]) {
      for (const { date } of list) {
        const k = weekKey(date);
        allWeekKeys.add(k);
        if (!weekLabels.has(k)) weekLabels.set(k, weekLabel(date));
      }
    }
    const sortedWeeks = [...allWeekKeys].sort().map((k) => ({ key: k, label: weekLabels.get(k)! }));

    // --- week × source tables per stage ---
    const stages = [
      { id: 'applied', title: 'Applied / Sourced', data: applied },
      { id: 'r1', title: 'Round 1', data: r1 },
      { id: 'r2', title: 'Round 2', data: r2 },
      { id: 'offers', title: 'Offers', data: offers },
      { id: 'joined', title: 'Joined / Accepted', data: joined },
    ];
    const weekSourceTables = stages.map((s) => ({
      id: s.id, title: s.title,
      ...weekSourceTable(s.data, sortedWeeks),
    }));

    // --- source conversion funnel ---
    const allSources = new Set<string>();
    for (const list of [applied, r1, r2, offers, joined]) for (const e of list) allSources.add(e.source);
    const srcFunnel = [...allSources].filter((s) => s !== '(unmatched)').sort().map((src) => {
      const apps = applied.filter((e) => e.source === src).length;
      const r1c = r1.filter((e) => e.source === src).length;
      const r2c = r2.filter((e) => e.source === src).length;
      const off = offers.filter((e) => e.source === src).length;
      const acc = joined.filter((e) => e.source === src).length;
      const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
      return {
        source: src, applications: apps, r1: r1c, r2: r2c, offers: off, accepted: acc,
        appToR1: pct(r1c, apps), r1ToR2: pct(r2c, r1c), r2ToOffer: pct(off, r2c),
        offerToAccept: pct(acc, off), overall: pct(acc, apps),
      };
    });
    // Grand total row
    const totals = {
      source: 'Grand Total',
      applications: applied.length, r1: r1.length, r2: r2.length, offers: offers.length, accepted: joined.length,
      appToR1: applied.length ? Math.round((r1.length / applied.length) * 1000) / 10 : 0,
      r1ToR2: r1.length ? Math.round((r2.length / r1.length) * 1000) / 10 : 0,
      r2ToOffer: r2.length ? Math.round((offers.length / r2.length) * 1000) / 10 : 0,
      offerToAccept: offers.length ? Math.round((joined.length / offers.length) * 1000) / 10 : 0,
      overall: applied.length ? Math.round((joined.length / applied.length) * 1000) / 10 : 0,
    };

    // --- average days between stages ---
    // For each candidate who reached R1+, compute days between stages.
    const candR1: Map<string, string> = new Map(); // email -> earliest R1 date
    const candR2: Map<string, string> = new Map();
    for (const i of iv) {
      const email = String(i.fields['Candidate Email'] ?? '').toLowerCase();
      const d = String(i.fields['Interview Date'] ?? '');
      if (!email || !d) continue;
      const round = String(i.fields['Round'] ?? '');
      if (round === 'Round 1') {
        const prev = candR1.get(email);
        if (!prev || d < prev) candR1.set(email, d);
      } else if (round === 'Round 2') {
        const prev = candR2.get(email);
        if (!prev || d < prev) candR2.set(email, d);
      }
    }

    const daysAppToR1: number[] = [];
    const daysR1ToR2: number[] = [];
    const daysR2ToOffer: number[] = [];
    const daysOfferToJoin: number[] = [];

    for (const c of cand) {
      const email = String(c.fields[F.email] ?? '').toLowerCase();
      const da = c.fields[F.dateApplied] ? String(c.fields[F.dateApplied]) : null;
      const r1d = candR1.get(email);
      const r2d = candR2.get(email);
      const od = c.fields[F.offerDate] ? String(c.fields[F.offerDate]) : null;
      const jd = c.fields[F.joinDate] ? String(c.fields[F.joinDate]) : null;

      if (da && r1d) { const d = daysBetween(da, r1d); if (d !== null && d >= 0) daysAppToR1.push(d); }
      if (r1d && r2d) { const d = daysBetween(r1d, r2d); if (d !== null && d >= 0) daysR1ToR2.push(d); }
      if (r2d && od) { const d = daysBetween(r2d, od); if (d !== null && d >= 0) daysR2ToOffer.push(d); }
      if (od && jd) { const d = daysBetween(od, jd); if (d !== null && d >= 0) daysOfferToJoin.push(d); }
    }

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
    const median = (arr: number[]) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    const velocity = [
      { transition: 'Applied → R1', avg: avg(daysAppToR1), median: median(daysAppToR1), count: daysAppToR1.length },
      { transition: 'R1 → R2', avg: avg(daysR1ToR2), median: median(daysR1ToR2), count: daysR1ToR2.length },
      { transition: 'R2 → Offer', avg: avg(daysR2ToOffer), median: median(daysR2ToOffer), count: daysR2ToOffer.length },
      { transition: 'Offer → Join', avg: avg(daysOfferToJoin), median: median(daysOfferToJoin), count: daysOfferToJoin.length },
    ];

    // --- interviewer load by week ---
    const interviewerWeeks = new Map<string, Map<string, number>>();
    for (const i of iv) {
      const interviewer = String(i.fields['Interviewer'] ?? '').trim();
      const d = String(i.fields['Interview Date'] ?? '');
      if (!interviewer || !d) continue;
      const wk = weekLabel(d);
      const row = interviewerWeeks.get(interviewer) ?? new Map();
      row.set(wk, (row.get(wk) ?? 0) + 1);
      interviewerWeeks.set(interviewer, row);
    }
    const iwWeeks = sortedWeeks.map((w) => w.label);
    const interviewerLoad = [...interviewerWeeks.entries()]
      .map(([name, weeks]) => {
        const cells: Record<string, number> = {};
        let total = 0;
        for (const w of iwWeeks) { const n = weeks.get(w) ?? 0; cells[w] = n; total += n; }
        return { interviewer: name, cells, total };
      })
      .sort((a, b) => b.total - a.total);

    res.json({
      geo: geo ?? 'All',
      candidateCount: cand.length,
      interviewCount: iv.length,
      weekSourceTables,
      sourceFunnel: [...srcFunnel, totals],
      velocity,
      interviewerLoad: { weeks: iwWeeks, rows: interviewerLoad },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
