import type { CandidateRecord, ParseResult } from '../../types.ts';
import { parseCsv, buildResult } from '../csv.ts';
import { normalizeName, normalizeEmail, parseFlexibleDate, classifyRow } from '../normalize.ts';

// The offer/join file wasn't sampled yet, so we auto-detect columns by header
// keyword. Adjust the alias lists once a real export is available.
const ALIASES: Record<string, string[]> = {
  name: ['candidate name', 'name', 'candidate', 'full name', 'employee name', 'applicant name', 'applicant'],
  email: ['email', 'candidate email', 'e-mail', 'email id', 'email address', 'mail', 'email_id', 'candidate_email', 'personal email', 'official email'],
  offerStatus: ['offer status', 'status', 'disposition', 'offer', 'result', 'outcome', 'final status', 'hiring status', 'offer outcome'],
  offerDate: ['offer date', 'offered on', 'date of offer', 'offer_date', 'offer made', 'offered date', 'offer sent'],
  joinDate: ['join date', 'joining date', 'date of joining', 'doj', 'join_date', 'start date', 'joining', 'expected doj', 'actual doj', 'date of join'],
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function detectColumns(headers: string[]): Record<string, string | undefined> {
  const map: Record<string, string | undefined> = {};
  for (const field of Object.keys(ALIASES)) {
    map[field] =
      headers.find((h) => ALIASES[field].includes(norm(h))) ??
      headers.find((h) => ALIASES[field].some((a) => norm(h).includes(a)));
  }
  return map;
}

function normalizeOfferStatus(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('join')) return 'Joined';
  if (v.includes('declin') || v.includes('withdraw') || v.includes('backout')) return 'Withdrawn';
  if (v.includes('offer')) return 'Offered';
  if (v.includes('hired')) return 'Hired';
  return raw as string;
}

/**
 * Offer & join status file — final HR check. Update-only: these records patch
 * status/offer/join dates onto existing candidates (matched on email by the
 * Airtable upsert). Unmatched rows are still returned but flagged update-only.
 */
export function parseOfferStatus(content: string, fileName?: string): ParseResult & { detectedColumns?: Record<string, string | undefined>; rawHeaders?: string[] } {
  const { headers, rows } = parseCsv(content);
  const cols = detectColumns(headers);

  if (!cols.email) {
    console.warn('[offer parser] Could not detect email column. Headers found:', headers.join(', '));
    console.warn('[offer parser] Expected one of: ' + ALIASES.email.join(', '));
  }

  const records: CandidateRecord[] = rows.map((row) => {
    const name = normalizeName(cols.name ? row[cols.name] : '');
    const email = normalizeEmail(cols.email ? row[cols.email] : '');
    const status = normalizeOfferStatus(cols.offerStatus ? row[cols.offerStatus] : '');
    return {
      name,
      email,
      status,
      offerDate: cols.offerDate ? parseFlexibleDate(row[cols.offerDate]) : null,
      joinDate: cols.joinDate ? parseFlexibleDate(row[cols.joinDate]) : null,
      sourceFile: fileName ?? null,
      updateOnly: true,
      flag: classifyRow(name, email),
    };
  });

  const result = buildResult('offer', rows.length, records);
  return { ...result, detectedColumns: cols, rawHeaders: headers };
}

export { detectColumns as detectOfferColumns };
