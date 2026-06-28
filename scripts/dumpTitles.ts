import 'dotenv/config';
import { google } from 'googleapis';
import { getAuthedClient } from '../server/google/oauth.ts';
import { listCalendarSources, listInterviewers } from '../server/airtable/client.ts';
import { parseEventTitle } from '../server/services/calendar/parseTitle.ts';
import { toConfig } from '../server/services/calendar/interviewerMatch.ts';

const auth = getAuthedClient();
const cal = google.calendar({ version: 'v3', auth });
const interviewers = toConfig(await listInterviewers());
const sources = await listCalendarSources();

const now = Date.now();
const timeMin = new Date(now - 30 * 86_400_000).toISOString();
const timeMax = new Date(now + 30 * 86_400_000).toISOString();

const titles: string[] = [];
for (const s of sources) {
  if (!s.email) continue;
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({ calendarId: s.email, singleEvents: true, maxResults: 2500, timeMin, timeMax, pageToken });
    for (const ev of res.data.items ?? []) if (ev.summary && ev.summary.includes('<>')) titles.push(ev.summary);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
}

console.log(`\n=== ${titles.length} interview-looking titles (contain "<>") ===\n`);

// unique titles with counts
const counts = new Map<string, number>();
for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1);
console.log(`unique: ${counts.size}\n--- first 50 unique raw titles ---`);
[...counts.entries()].slice(0, 50).forEach(([t, n]) => console.log(`(${n})  ${JSON.stringify(t)}`));

// errors
console.log('\n--- parse errors ---');
const seen = new Set<string>();
let errs = 0;
for (const t of titles) {
  try { parseEventTitle(t, interviewers); }
  catch (e) {
    errs++;
    if (!seen.has(t)) { seen.add(t); console.log(`ERR ${(e as Error).message} :: ${JSON.stringify(t)}`); }
  }
}
console.log(`total erroring instances: ${errs}, distinct: ${seen.size}`);
