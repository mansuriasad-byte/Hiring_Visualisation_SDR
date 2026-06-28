import type { calendar_v3 } from 'googleapis';
import type { ParsedTitle } from './parseTitle.ts';

// Organizers whose 1:1 (single external attendee) events are interviews.
const INTERVIEW_ORGANIZERS = ['abhilasha.sharma@leena.ai', 'mayanka.trehan@leena.ai'];

// Phrases that suggest an interview when 2+ appear in the description.
// TODO: replace with the exact phrase list from the prior exercise if available.
const INTERVIEW_PHRASES = [
  'interview', 'candidate', 'resume', 'cv', 'notice period', 'ctc',
  'years of experience', 'shortlist', 'job description', 'hiring',
  'screening', 'recruit', 'panel', 'profile review', 'availability for',
];

const INTERNAL = '@leena.ai';
// Only a *resume/CV* attachment counts — not any deck/doc (avoids townhalls,
// overviews, etc. that merely have a slide attachment).
const isResumeAttachment = (a: calendar_v3.Schema$EventAttachment) => {
  const t = (a.title ?? '').toLowerCase();
  return /\b(cv|resume|r[eé]sum[eé]|profile)\b/.test(t);
};

export interface Classification {
  isInterview: boolean;
  confidence: 'high' | 'medium' | null;
  matchedBy: string | null;
  reason: string | null; // why skipped
}

/**
 * Decide whether a calendar event is an interview, per the agreed rules:
 *  - EXCLUDE eventType focusTime / fromGmail
 *  - EXCLUDE titles containing "Placeholder"
 *  - HIGH: pipe-delimited interview title  (round | role | cand <> interviewer | ...)
 *  - HIGH: organizer is a TA coordinator AND exactly one external attendee
 *  - MEDIUM: description contains 2+ interview phrases
 *  - MEDIUM: has a CV/resume attachment
 *  - else NOT an interview
 */
export function classifyEvent(ev: calendar_v3.Schema$Event, parsed: ParsedTitle): Classification {
  const eventType = ev.eventType ?? 'default';
  if (eventType === 'focusTime' || eventType === 'fromGmail') {
    return { isInterview: false, confidence: null, matchedBy: null, reason: `eventType:${eventType}` };
  }
  if ((ev.summary ?? '').toLowerCase().includes('placeholder')) {
    return { isInterview: false, confidence: null, matchedBy: null, reason: 'placeholder' };
  }

  // Rule 3 — structured interview title
  if (parsed.isInterview) {
    return { isInterview: true, confidence: 'high', matchedBy: 'title-pattern', reason: null };
  }

  // Rule 4 — TA coordinator 1:1 with a single external attendee
  const organizer = (ev.organizer?.email ?? '').toLowerCase();
  const external = (ev.attendees ?? [])
    .map((a) => (a.email ?? '').toLowerCase())
    .filter((e) => e && !e.endsWith(INTERNAL));
  if (INTERVIEW_ORGANIZERS.includes(organizer) && external.length === 1) {
    return { isInterview: true, confidence: 'high', matchedBy: 'organizer+attendee', reason: null };
  }

  // Rule 5 — interview-y description
  const desc = (ev.description ?? '').toLowerCase();
  const hits = INTERVIEW_PHRASES.filter((p) => desc.includes(p)).length;
  if (hits >= 2) {
    return { isInterview: true, confidence: 'medium', matchedBy: `description(${hits})`, reason: null };
  }

  // Rule 6 — resume/CV attachment
  if ((ev.attachments ?? []).some(isResumeAttachment)) {
    return { isInterview: true, confidence: 'medium', matchedBy: 'attachment', reason: null };
  }

  return { isInterview: false, confidence: null, matchedBy: null, reason: 'no signal' };
}
