import { google, type calendar_v3 } from 'googleapis';
import { getAuthedClient } from './oauth.ts';
import { parseEventTitle, type ParsedTitle } from '../services/calendar/parseTitle.ts';
import { classifyEvent, type Classification } from '../services/calendar/classify.ts';
import { toConfig } from '../services/calendar/interviewerMatch.ts';
import {
  listCalendarSources, listInterviewers, loadCandidateKeys,
  touchCalendarSource, upsertInterviews, upsertCandidates,
  listRecords, type CalendarSourceRow, type AirtableRecord,
} from '../airtable/client.ts';
import { F } from '../airtable/schema.ts';

export interface SyncOptions {
  since?: string; // ISO date; full pull from this date (ignores incremental cursor)
  windowDays?: number; // days back when no `since` (default 30)
  forwardDays?: number; // days forward (default 90)
  dryRun?: boolean;
}

export interface SyncSummary {
  dryRun: boolean;
  fetchedAt: string;
  window: { since: string | null; forwardDays: number };
  sources: { name: string; email: string; fetched: number; error?: string }[];
  totalFetched: number;
  interviews: number; // classified as interview (pre-dedup)
  byConfidence: { high: number; medium: number };
  skipped: number;
  skippedReasons: Record<string, number>;
  uniqueInterviews: number; // after iCal dedup
  needsReview: number;
  inScope: number;
  matchedCandidates: number;
  parseErrors: number;
  written: { created: number; updated: number };
  reconciled?: ReconcileResult;
  sample: Record<string, unknown>[];
}

const INTERNAL = '@leena.ai';

async function fetchEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  lastSynced: string | null,
  opts: SyncOptions,
): Promise<calendar_v3.Schema$Event[]> {
  const now = Date.now();
  const forwardDays = opts.forwardDays ?? 90;
  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    singleEvents: true,
    showDeleted: true,
    maxResults: 2500,
    timeMax: new Date(now + forwardDays * 86_400_000).toISOString(),
  };
  if (opts.since) {
    params.timeMin = new Date(opts.since).toISOString();
  } else {
    params.timeMin = new Date(now - (opts.windowDays ?? 30) * 86_400_000).toISOString();
    if (lastSynced) params.updatedMin = new Date(lastSynced).toISOString();
  }

  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({ ...params, pageToken });
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

function buildFields(
  p: ParsedTitle,
  c: Classification,
  ev: calendar_v3.Schema$Event,
  source: CalendarSourceRow,
  candidateKeys: { emails: Set<string>; names: Set<string> },
  fetchedAt: string,
): Record<string, unknown> {
  const title = ev.summary ?? '';
  const startDt = ev.start?.dateTime ?? ev.start?.date ?? null;
  const endDt = ev.end?.dateTime ?? ev.end?.date ?? null;
  const durationMin =
    ev.start?.dateTime && endDt ? Math.round((+new Date(endDt) - +new Date(startDt!)) / 60000) : null;

  const externalAttendee = (ev.attendees ?? []).find(
    (a) => a.email && !a.email.toLowerCase().endsWith(INTERNAL),
  );
  const candEmail = externalAttendee?.email ?? null;
  // Prefer the parsed candidate name; fall back to the external attendee.
  const candidateName = p.candidateName ?? externalAttendee?.displayName ?? null;

  const emailKey = (candEmail ?? '').toLowerCase();
  const nameKey = (candidateName ?? '').toLowerCase();
  const matchedCand = Boolean(
    (emailKey && candidateKeys.emails.has(emailKey)) || (nameKey && candidateKeys.names.has(nameKey)),
  );

  // Structured (pipe) titles carry round/role/interviewer; the medium-confidence
  // matches don't, so they always need review.
  const needsReview = p.isInterview ? p.needsReview : true;

  const fields: Record<string, unknown> = {
    Summary: p.isInterview
      ? [candidateName, p.round, p.interviewer].filter(Boolean).join(' · ') || title
      : `${candidateName ?? title} (${c.matchedBy})`,
    'Candidate Name': candidateName ?? '',
    'Candidate Email': candEmail ?? '',
    'Matched Candidate': matchedCand,
    Interviewer: p.interviewer ?? '',
    'Interviewer Matched': p.matched,
    Round: p.round ?? '',
    Role: p.role ?? '',
    Geo: p.geo ?? '',
    'In Scope': Boolean(p.inScope),
    'Interview Date': startDt,
    'Duration (min)': durationMin,
    'Event Status': ev.status ?? '',
    'Event Type': ev.eventType ?? '',
    Confidence: c.confidence ?? '',
    'Matched By': c.matchedBy ?? '',
    'Calendar Source': source.email,
    iCalUID: ev.iCalUID ?? ev.id ?? '',
    Rescheduled: p.rescheduled,
    'Needs Review': needsReview,
    'Review Reason': needsReview ? (p.reason ?? 'unstructured (medium confidence)') : '',
    'Raw Title': title,
    'Fetched At': fetchedAt,
  };
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    if (v === '' || v === null || v === undefined) delete fields[k];
  }
  return fields;
}

/** Pull interview events from all active calendar sources into the Interviews table. */
export async function syncCalendars(opts: SyncOptions = {}): Promise<SyncSummary> {
  const fetchedAt = new Date().toISOString();
  const dryRun = Boolean(opts.dryRun);

  const auth = getAuthedClient();
  const cal = google.calendar({ version: 'v3', auth });

  const [sources, interviewerRows, candidateKeys] = await Promise.all([
    listCalendarSources(),
    listInterviewers(),
    loadCandidateKeys(),
  ]);
  const interviewers = toConfig(interviewerRows);

  const summary: SyncSummary = {
    dryRun, fetchedAt, window: { since: opts.since ?? null, forwardDays: opts.forwardDays ?? 90 },
    sources: [], totalFetched: 0, interviews: 0, byConfidence: { high: 0, medium: 0 },
    skipped: 0, skippedReasons: {}, uniqueInterviews: 0, needsReview: 0, inScope: 0,
    matchedCandidates: 0, parseErrors: 0, written: { created: 0, updated: 0 }, sample: [],
  };

  const byUid = new Map<string, Record<string, unknown>>();

  for (const source of sources) {
    if (!source.email) {
      summary.sources.push({ name: source.name, email: '(no email)', fetched: 0, error: 'missing Email' });
      continue;
    }
    try {
      const events = await fetchEvents(cal, source.email, source.lastSynced, opts);
      summary.sources.push({ name: source.name, email: source.email, fetched: events.length });
      summary.totalFetched += events.length;

      for (const ev of events) {
        try {
          const evDate = ev.start?.dateTime ?? ev.start?.date ?? null;
          const p = parseEventTitle(ev.summary ?? '', interviewers, evDate);
          const c = classifyEvent(ev, p);
          if (!c.isInterview) {
            summary.skipped++;
            const r = c.reason ?? 'unknown';
            summary.skippedReasons[r] = (summary.skippedReasons[r] ?? 0) + 1;
            continue;
          }
          summary.interviews++;
          if (c.confidence) summary.byConfidence[c.confidence]++;

          const f = buildFields(p, c, ev, source, candidateKeys, fetchedAt);
          const uid = String(f.iCalUID ?? '');
          if (!uid) continue;
          const existing = byUid.get(uid);
          if (!existing) {
            byUid.set(uid, f);
          } else {
            const better =
              (!existing['Interviewer Matched'] && f['Interviewer Matched']) ||
              (existing['Needs Review'] && !f['Needs Review']);
            if (better) byUid.set(uid, f);
          }
        } catch {
          summary.parseErrors++;
        }
      }
      if (!dryRun) await touchCalendarSource(source.id, fetchedAt);
    } catch (err) {
      summary.sources.push({ name: source.name, email: source.email, fetched: 0, error: (err as Error).message });
    }
  }

  const fields = [...byUid.values()];
  summary.uniqueInterviews = fields.length;
  for (const f of fields) {
    if (f['Needs Review']) summary.needsReview++;
    if (f['In Scope']) summary.inScope++;
    if (f['Matched Candidate']) summary.matchedCandidates++;
  }

  summary.sample = fields.slice(0, 15).map((f) => ({
    Summary: f.Summary, Confidence: f.Confidence, MatchedBy: f['Matched By'],
    Round: f.Round, Role: f.Role, Geo: f.Geo, Interviewer: f.Interviewer,
    Candidate: f['Candidate Name'], InScope: f['In Scope'], NeedsReview: f['Needs Review'],
    Date: f['Interview Date'],
  }));

  if (!dryRun && fields.length) summary.written = await upsertInterviews(fields);

  if (!dryRun) {
    summary.reconciled = await reconcileUnmatchedInterviews();
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Reconcile unmatched interviews → create candidate stubs
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  unmatchedEmails: number;
  fromReferral: number;
  fromSourced: number;
  created: number;
  updated: number;
}

/**
 * Find in-scope SDR interviews whose Candidate Email doesn't exist in the
 * Candidates table. For each unique email:
 *   1. Check if any existing Referral candidate matches by name →
 *      create candidate with Source=Referral, Date Applied = referral date
 *   2. Otherwise → create candidate with Source=Sourced,
 *      Date Applied = earliest interview date
 */
export async function reconcileUnmatchedInterviews(): Promise<ReconcileResult> {
  const [candRecs, ivRecs] = await Promise.all([
    listRecords('Candidates'),
    listRecords('Interviews'),
  ]);

  const candByEmail = new Set<string>();
  const referralsByName = new Map<string, AirtableRecord>();
  for (const c of candRecs) {
    const email = String(c.fields[F.email] ?? '').toLowerCase();
    if (email) candByEmail.add(email);
    if (c.fields[F.source] === 'Referral') {
      const name = String(c.fields[F.name] ?? '').trim().toLowerCase();
      if (name) referralsByName.set(name, c);
    }
  }

  const sdrIvs = ivRecs.filter((i) =>
    i.fields['In Scope'] === true && i.fields['Role'] === 'SDR',
  );

  // Group unmatched interviews by email, keeping the earliest date and name
  const unmatched = new Map<string, { name: string; email: string; role: string; geo: string; earliestDate: string }>();
  for (const i of sdrIvs) {
    const email = String(i.fields['Candidate Email'] ?? '').toLowerCase();
    if (!email || candByEmail.has(email)) continue;
    const existing = unmatched.get(email);
    const iDate = String(i.fields['Interview Date'] ?? '').slice(0, 10);
    if (!existing) {
      unmatched.set(email, {
        name: String(i.fields['Candidate Name'] ?? ''),
        email,
        role: String(i.fields['Role'] ?? 'SDR'),
        geo: String(i.fields['Geo'] ?? 'Unknown'),
        earliestDate: iDate,
      });
    } else if (iDate && (!existing.earliestDate || iDate < existing.earliestDate)) {
      existing.earliestDate = iDate;
    }
  }

  if (!unmatched.size) return { unmatchedEmails: 0, fromReferral: 0, fromSourced: 0, created: 0, updated: 0 };

  let fromReferral = 0;
  let fromSourced = 0;
  const stubs: Record<string, unknown>[] = [];

  for (const [, info] of unmatched) {
    const nameKey = info.name.trim().toLowerCase();
    const refMatch = referralsByName.get(nameKey);

    if (refMatch) {
      fromReferral++;
      stubs.push({
        [F.name]: info.name,
        [F.email]: info.email,
        [F.role]: info.role,
        [F.geo]: info.geo,
        [F.inScope]: true,
        [F.source]: 'Referral',
        [F.dateApplied]: refMatch.fields[F.dateApplied] ?? (info.earliestDate || null),
        [F.referrer]: refMatch.fields[F.referrer] ?? null,
        [F.status]: 'Active',
        [F.sourceFile]: 'calendar-reconcile',
      });
    } else {
      fromSourced++;
      stubs.push({
        [F.name]: info.name,
        [F.email]: info.email,
        [F.role]: info.role,
        [F.geo]: info.geo,
        [F.inScope]: true,
        [F.source]: 'Sourced',
        [F.dateApplied]: info.earliestDate || null,
        [F.status]: 'Active',
        [F.sourceFile]: 'calendar-reconcile',
      });
    }
  }

  // Remove null/empty fields
  for (const s of stubs) {
    for (const k of Object.keys(s)) {
      if (s[k] === null || s[k] === undefined || s[k] === '') delete s[k];
    }
  }

  const res = await upsertCandidates(stubs, ['Email']);
  return { unmatchedEmails: unmatched.size, fromReferral, fromSourced, created: res.created, updated: res.updated };
}
