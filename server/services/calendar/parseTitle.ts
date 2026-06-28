import { normalizeName, parseRoleTitle } from '../normalize.ts';
import { matchInterviewer, isConfidentMatch, type InterviewerConfig } from './interviewerMatch.ts';

export interface ParsedTitle {
  raw: string;
  isInterview: boolean; // 4-segment "round | role-geo | cand <> interviewer | ..." shape
  round: string | null;
  roundKnown: boolean;
  role: string | null;
  geo: string | null;
  inScope: boolean;
  candidateName: string | null;
  interviewerRaw: string | null;
  interviewer: string | null; // canonical name(s), comma-joined
  matched: boolean;
  company: string | null;
  rescheduled: boolean;
  needsReview: boolean;
  reason: string | null;
}

function normalizeRound(raw: string): { round: string; known: boolean } {
  const s = raw.trim().toLowerCase();
  if (/cultural|^cr$|^hr\b.*round/.test(s)) return { round: 'Cultural Round', known: true };
  if (/screen/.test(s)) return { round: 'Screening', known: true };
  if (/assess|assignment/.test(s)) return { round: 'Assessment', known: true };
  if (/\b(r|round)\s*0*1\b/.test(s) || /round one/.test(s)) return { round: 'Round 1', known: true };
  if (/\b(r|round)\s*0*2\b/.test(s) || /round two/.test(s)) return { round: 'Round 2', known: true };
  if (/\b(r|round)\s*0*3\b/.test(s) || /round three/.test(s)) return { round: 'Round 3', known: true };
  if (/\b(r|round)\s*0*4\b/.test(s)) return { round: 'Round 4', known: true };
  return { round: raw.trim(), known: false };
}

const splitNames = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Parse an interview event title. Real interviews are 4 segments:
 *   "R2 | SDR - US | Candidate <> Interviewer[, Interviewer2] | Leena.ai"
 * Casual chats are 3 segments ("Let's Connect | Name <> Richa | Leena.ai") with
 * the people in segment 1 and no role segment — those are NOT interviews.
 * We locate the people segment by "<>", so an interview requires it at index >= 2
 * (i.e. a round and a role segment precede it).
 */
export function parseEventTitle(
  title: string,
  interviewers: InterviewerConfig[],
  dateIso?: string | null,
): ParsedTitle {
  const raw = title ?? '';
  let t = raw.trim();

  let rescheduled = false;
  const resched = t.match(/^\[?\s*(re-?scheduled)\s*\]?\s*[-:]?\s*/i);
  if (resched) { rescheduled = true; t = t.slice(resched[0].length).trim(); }

  const base: ParsedTitle = {
    raw, isInterview: false, round: null, roundKnown: false, role: null, geo: null,
    inScope: false, candidateName: null, interviewerRaw: null, interviewer: null,
    matched: false, company: null, rescheduled, needsReview: false, reason: null,
  };

  const segments = t.split('|').map((s) => s.trim()).filter(Boolean);
  const peopleIdx = segments.findIndex((s) => s.includes('<>'));
  if (peopleIdx === -1) return { ...base, reason: 'no "<>" people segment' };

  const { round, known } = peopleIdx >= 1 ? normalizeRound(segments[0]) : { round: null as string | null, known: false };
  const roleSeg = peopleIdx >= 2 ? segments[peopleIdx - 1] : '';
  const roleInfo = parseRoleTitle(roleSeg);
  const company = segments[peopleIdx + 1] ?? null;

  const [lraw, rraw] = segments[peopleIdx].split('<>').map((s) => (s ?? '').trim());
  const leftNames = splitNames(lraw);
  const rightNames = splitNames(rraw);
  // Keep each match's confidence so we can distinguish a trusted panel member
  // from an uncertain fuzzy hit that must be reviewed.
  const matchSide = (names: string[]) =>
    names
      .map((n) => matchInterviewer(n, interviewers, dateIso))
      .filter((m) => !!m.matched) as { matched: InterviewerConfig; confidence: ReturnType<typeof matchInterviewer>['confidence'] }[];
  const rm = matchSide(rightNames);
  const lm = matchSide(leftNames);

  let candidateRaw: string;
  let interviewerNames: string[];
  let matchedList: typeof rm;
  if (rm.length) { candidateRaw = lraw; interviewerNames = rightNames; matchedList = rm; }
  else if (lm.length) { candidateRaw = rraw; interviewerNames = leftNames; matchedList = lm; } // swapped
  else { candidateRaw = lraw; interviewerNames = rightNames; matchedList = []; }

  const interviewer = matchedList.length
    ? [...new Set(matchedList.map((m) => m.matched.name))].join(', ')
    : interviewerNames.join(', ') || null;
  const candidateName = normalizeName(candidateRaw) || null;

  // Real interview => people segment has a round + role segment before it.
  const isInterview = peopleIdx >= 2;
  const matched = matchedList.length > 0;
  // Rule: an interviewer outside our panel (no match) or only an uncertain
  // fuzzy/ambiguous match is "of no use" until a human confirms — flag it.
  const allConfident = matched && matchedList.every((m) => isConfidentMatch(m.confidence));

  let reason: string | null = null;
  if (isInterview) {
    if (!matched) reason = 'interviewer not in panel';
    else if (!allConfident) reason = 'interviewer match uncertain (verify)';
    else if (!candidateName) reason = 'candidate name missing';
  }
  const needsReview = reason !== null;

  return {
    raw,
    isInterview,
    round,
    roundKnown: known,
    role: roleInfo.role,
    geo: roleInfo.geo,
    inScope: roleInfo.inScope,
    candidateName,
    interviewerRaw: rraw || lraw || null,
    interviewer,
    matched,
    company,
    rescheduled,
    needsReview,
    reason,
  };
}
