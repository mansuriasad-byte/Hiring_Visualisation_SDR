import { google, type calendar_v3 } from 'googleapis';
import { getAuthedClient } from './oauth.ts';
import { parseEventTitle, type ParsedTitle } from '../services/calendar/parseTitle.ts';
import { classifyEvent, type Classification } from '../services/calendar/classify.ts';
import { toConfig } from '../services/calendar/interviewerMatch.ts';
import {
  listCalendarSources, listInterviewers, loadCandidateKeys,
  touchCalendarSource, upsertInterviews, type CalendarSourceRow,
} from '../airtable/client.ts';

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
  return summary;
}
