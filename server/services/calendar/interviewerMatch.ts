import { normalizeName } from '../normalize.ts';

export interface InterviewerConfig {
  name: string; // canonical display name
  aliases: string[]; // alternate names (incl. the canonical name)
  geoPool?: string; // US | Europe | Both
}

/** Build matcher config from the comma-separated alias strings we store in Airtable. */
export function toConfig(rows: { name?: string | null; aliases?: string | null; geoPool?: string | null }[]): InterviewerConfig[] {
  return rows
    .filter((r) => r.name && String(r.name).trim()) // skip blank rows
    .map((r) => {
      const name = String(r.name).trim();
      const aliases = (r.aliases ?? '')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (!aliases.some((a) => a.toLowerCase() === name.toLowerCase())) aliases.unshift(name);
      return { name, aliases, geoPool: r.geoPool ?? undefined };
    });
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[m];
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const firstName = (s: unknown) => norm(s).split(' ')[0] ?? '';

export type MatchConfidence = 'exact' | 'alias' | 'rule' | 'fuzzy' | 'ambiguous' | 'none';

export interface MatchResult {
  matched: InterviewerConfig | null;
  confidence: MatchConfidence;
}

/**
 * A confident match is one we trust enough to NOT flag for review: an exact /
 * alias hit, or a documented disambiguation rule. A `fuzzy` (typo-distance)
 * match or an unresolved `ambiguous` first name is uncertain — per the agreed
 * rule, those go to manual review rather than being silently accepted.
 */
export function isConfidentMatch(c: MatchConfidence): boolean {
  return c === 'exact' || c === 'alias' || c === 'rule';
}

// Two interviewers share the first name "Shubham". Shubham Mittal took his last
// interview ~10 Jun 2026; Shubham Gill joined 15 Jun 2026. So a bare "Shubham"
// before the cutoff is Mittal, on/after is Gill.
const SHUBHAM_CUTOFF = '2026-06-10';

function disambiguateByDate(
  fn: string,
  candidates: InterviewerConfig[],
  dateIso?: string | null,
): InterviewerConfig | null {
  if (fn === 'shubham' && dateIso) {
    const day = String(dateIso).slice(0, 10);
    const wanted = day < SHUBHAM_CUTOFF ? 'Shubham Mittal' : 'Shubham Gill';
    return candidates.find((c) => c.name === wanted) ?? null;
  }
  return null;
}

/**
 * Match a calendar name token to a configured interviewer.
 *  1. Exact full-name / alias match.
 *  2. First-name match — unique hit is an alias match; a multi-hit (the two
 *     Shubhams) is resolved by the date-based rule when possible, else ambiguous.
 *  3. Fuzzy (Levenshtein <= 2) on any alias — uncertain, caller should review.
 *
 * `dateIso` (the interview date) powers the first-name disambiguation rule.
 */
export function matchInterviewer(
  raw: string,
  interviewers: InterviewerConfig[],
  dateIso?: string | null,
): MatchResult {
  if (typeof raw !== 'string') return { matched: null, confidence: 'none' };
  const n = norm(raw);
  if (!n) return { matched: null, confidence: 'none' };

  // 1. exact alias / name
  for (const iv of interviewers) {
    if (iv.aliases.some((a) => norm(a) === n)) return { matched: iv, confidence: 'exact' };
  }

  // 2. first-name match
  const fn = firstName(raw);
  const byFirst = interviewers.filter((iv) => iv.aliases.some((a) => firstName(a) === fn));
  if (byFirst.length === 1) return { matched: byFirst[0], confidence: 'alias' };
  if (byFirst.length > 1) {
    const resolved = disambiguateByDate(fn, byFirst, dateIso);
    if (resolved) return { matched: resolved, confidence: 'rule' };
    return { matched: null, confidence: 'ambiguous' };
  }

  // 3. fuzzy
  let best: InterviewerConfig | null = null;
  let bestD = Infinity;
  for (const iv of interviewers) {
    for (const a of iv.aliases) {
      const d = levenshtein(n, norm(a));
      if (d < bestD) { bestD = d; best = iv; }
    }
  }
  if (best && bestD <= 2) return { matched: best, confidence: 'fuzzy' };

  return { matched: null, confidence: 'none' };
}

export { normalizeName };
