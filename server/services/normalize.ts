// Shared normalization used by all parsers. Tuned against the real PyJaama HR
// ATS export and Employee Referral dump.

import { getSourceGroupConfig } from './sourceGroups.ts';

export function looksLikeEmail(s: unknown): boolean {
  return typeof s === 'string' && s.includes('@');
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return v.length ? v : null;
}

/** Title-case, collapse whitespace, flip "Last, First" -> "First Last". */
export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let v = raw.trim().replace(/\s+/g, ' ');
  if (!v) return '';
  const comma = v.indexOf(',');
  if (comma !== -1) {
    const last = v.slice(0, comma).trim();
    const first = v.slice(comma + 1).trim();
    if (first && last) v = `${first} ${last}`;
  }
  return v
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function normalizePhone(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).replace(/\D/g, '');
  return v.length ? v : null;
}

/** Some referral rows have name/email columns swapped. Fix when detectable. */
export function maybeSwapNameEmail(nameRaw: string, emailRaw: string): { name: string; email: string } {
  if (!looksLikeEmail(emailRaw) && looksLikeEmail(nameRaw)) {
    return { name: emailRaw, email: nameRaw };
  }
  return { name: nameRaw, email: emailRaw };
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parse the date formats seen across exports -> ISO (YYYY-MM-DD):
 *  - "10 Jun, 2026"            (legacy ATS)
 *  - "Jun 10, 2026 01:39 PM"   (referral dump)
 *  - "3/16/2026" / "3/6/26"    (real "All ATS Candidates" export, US M/D/Y)
 */
export function parseFlexibleDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v === 'N/A' || v === '-') return null;
  // "DD Mon, YYYY"
  let m = v.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }
  // "Mon DD, YYYY"
  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }
  // "M/D/YYYY" or "M/D/YY" — US ordering (month first), as in the ATS export.
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }
  return null;
}

export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[, ]/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Role + geo + scope
// ---------------------------------------------------------------------------

export interface RoleInfo {
  role: 'SDR' | 'SDR Manager' | 'Other';
  geo: 'US' | 'Europe' | 'ROW' | 'Unknown';
  roleDetail: string; // cleaned original title
  inScope: boolean; // SDR (IC) in US or Europe
}

/**
 * Map a free-text job title to canonical role/geo. The referral dump has many
 * variants: "Sales Development Representative- US", "SDR - US",
 * "...Europe", "...North America", "Sales Development Manager- US", "SDR role
 * in SEA", plus dozens of non-SDR roles (QA, SDE, PM, ...).
 */
export function parseRoleTitle(raw: unknown): RoleInfo {
  const original = (typeof raw === 'string' ? raw : '').trim().replace(/\s+/g, ' ');
  const t = original.toLowerCase();
  const roleDetail = original ? normalizeName(original) : '';

  let geo: RoleInfo['geo'] = 'Unknown';
  if (/europe|emea/.test(t)) geo = 'Europe';
  else if (/north america|\bus\b|u\.s\.?|united states|\bna\b/.test(t)) geo = 'US';
  else if (/\brow\b|\bsea\b|south.?east asia|apac/.test(t)) geo = 'ROW';

  const isSDR = /\bsdr\b/.test(t) || /sales development/.test(t) ||
    /\bbdr\b/.test(t) || /business development representative/.test(t);
  // "SDM" / "Sales Development Manager" are the manager role (seen in calendar titles).
  const isManager = /manager/.test(t) || /\bsdm\b/.test(t) || /sales development manager/.test(t);

  if ((isSDR || /\bsdm\b/.test(t)) && isManager) {
    return { role: 'SDR Manager', geo, roleDetail: roleDetail || 'SDR Manager', inScope: false };
  }
  if (isSDR) {
    return { role: 'SDR', geo, roleDetail: 'SDR', inScope: geo === 'US' || geo === 'Europe' };
  }
  return { role: 'Other', geo: 'Unknown', roleDetail: roleDetail || 'Other', inScope: false };
}

// ---------------------------------------------------------------------------
// Stage / status / source / disposition mapping
// ---------------------------------------------------------------------------

const STAGE_MAP: Record<string, string> = {
  applied: 'Applied', application: 'Applied', new: 'Applied',
  screening: 'Screening', screen: 'Screening', 'phone screen': 'Screening',
  r1: 'Round 1', 'round 1': 'Round 1',
  r2: 'Round 2', 'round 2': 'Round 2',
  cr: 'Cultural Round', cultural: 'Cultural Round', 'cultural round': 'Cultural Round',
  offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn',
};

export function normalizeStage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  return STAGE_MAP[v.toLowerCase()] ?? v;
}

// Canonical funnel stage order (used for dashboards / "furthest stage reached").
export const STAGE_ORDER = [
  'Sourced', 'Applied', 'Recruiter Screening', 'CV Review',
  'Round 1', 'Round 2', 'Round 3', 'Cultural Round', 'Offer', 'Hired', 'Rejected',
] as const;

/**
 * Map a raw `pipeline` value from the real "All ATS Candidates" export to a
 * canonical funnel stage + candidate status. The pipeline column conflates the
 * furthest stage reached with the outcome (e.g. "R1 Reject" = reached Round 1,
 * then rejected), so we split it into the two fields the dashboards need.
 */
export interface AtsPipeline { stage: string; status: string }

export const ATS_PIPELINE: Record<string, AtsPipeline> = {
  'applied': { stage: 'Applied', status: 'Active' },
  'sourced': { stage: 'Sourced', status: 'Active' },
  'source': { stage: 'Sourced', status: 'Active' },
  'recruiter screening': { stage: 'Recruiter Screening', status: 'Active' },
  'recruiter screening reject': { stage: 'Recruiter Screening', status: 'Rejected' },
  'recruiter screening reject post call': { stage: 'Recruiter Screening', status: 'Rejected' },
  'shortlisted basis cv': { stage: 'CV Review', status: 'Active' },
  'cv shared with hm': { stage: 'CV Review', status: 'Active' },
  'shared for review': { stage: 'CV Review', status: 'Active' },
  'cv rejected hm': { stage: 'CV Review', status: 'Rejected' },
  'rejected by hm': { stage: 'CV Review', status: 'Rejected' },
  'r1': { stage: 'Round 1', status: 'Active' },
  'r1 reject': { stage: 'Round 1', status: 'Rejected' },
  'r1 backout': { stage: 'Round 1', status: 'Backout' },
  'r2': { stage: 'Round 2', status: 'Active' },
  'r2 reject': { stage: 'Round 2', status: 'Rejected' },
  'r3': { stage: 'Round 3', status: 'Active' },
  'r3 reject': { stage: 'Round 3', status: 'Rejected' },
  'offer rejected': { stage: 'Offer', status: 'Rejected' },
  'hired': { stage: 'Hired', status: 'Hired' },
  'not interested': { stage: 'Rejected', status: 'Rejected' },
  'not responding follow up': { stage: 'Rejected', status: 'Rejected' },
  'location': { stage: 'Rejected', status: 'Rejected' },
  'rejected': { stage: 'Rejected', status: 'Rejected' },
};

/** Returns null for blank/unknown pipeline values (caller defaults to Applied/Active). */
export function mapAtsPipeline(raw: unknown): AtsPipeline | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return null;
  return ATS_PIPELINE[key] ?? null;
}

export function normalizeSource(raw: unknown): string {
  const v = String(raw ?? '').trim();
  const vLow = v.toLowerCase();
  if (!vLow || vLow === '-') return 'Other';

  // If the raw value is explicitly listed in the source group config, preserve it
  // as-is — groupSource() handles display grouping at query time.
  const cfg = getSourceGroupConfig();
  for (const rawValues of Object.values(cfg.groups)) {
    for (const rv of rawValues) {
      if (rv.toLowerCase() === vLow) return rv;
    }
  }

  if (vLow.includes('linkedin')) return 'LinkedIn';
  if (vLow.includes('referral')) return 'Referral';
  if (vLow.includes('job') || vLow.includes('naukri') || vLow.includes('indeed')) return 'Job Board';
  if (vLow.includes('sourc')) return 'Sourced';
  if (vLow.includes('direct')) return 'Direct';
  return 'Other';
}

/** Canonicalize referral "TA Response" values (note the source typo "Recuriter"). */
export function normalizeDisposition(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const low = v.toLowerCase();
  if (low.includes('recuriter') || low.includes('recruiter')) return 'Recruiter Screening';
  if (low.includes('hiring manager')) return 'Hiring Manager Reject';
  if (low.includes('interview reject')) return 'Interview Reject';
  if (low.includes('not relevant')) return 'Rejected Not Relevant';
  if (low === 'duplicate') return 'Duplicate';
  if (low === 'backout') return 'Backout';
  if (low === 'over budget') return 'Over Budget';
  if (low === 'offered') return 'Offered';
  if (low === 'joined') return 'Joined';
  if (low === 'processing') return 'Processing';
  return v;
}

/** Best-effort candidate status from a referral disposition. */
export function statusFromDisposition(disposition: string | null): string {
  switch (disposition) {
    case 'Joined': return 'Joined';
    case 'Offered': return 'Offered';
    case 'Backout': return 'Backout';
    case 'Rejected Not Relevant':
    case 'Hiring Manager Reject':
    case 'Interview Reject':
    case 'Over Budget':
      return 'Rejected';
    default: return 'Active';
  }
}

// ---------------------------------------------------------------------------
// Junk / test-row detection
// ---------------------------------------------------------------------------

const TEST_DOMAINS = ['leena.ai'];
const TEST_NAME = /^(test|testing|dummy|asdf|qwerty|lol+|abc)\b/i;

export function classifyRow(name: string, email: string | null): 'test' | 'no_email' | 'bad_email' | null {
  // Garbage names: blank, no letters at all ("1 1", "0 0", "1 2"), or obvious
  // test tokens. Real names legitimately contain parens, digits, and other
  // marks ("Deva Dharshini (DD)", "Anoop Upadhyaya- SAFe SPC6"), so we no
  // longer reject on stray symbols — only on the absence of any letters.
  if (!name || !/[a-zA-Z]/.test(name) || TEST_NAME.test(name)) return 'test';
  if (!email) return 'no_email';
  const domain = email.split('@')[1] ?? '';
  if (TEST_DOMAINS.includes(domain)) return 'test';
  if (!isValidEmail(email)) return 'bad_email';
  return null;
}
