import { parseEventTitle } from '../server/services/calendar/parseTitle.ts';
import { toConfig } from '../server/services/calendar/interviewerMatch.ts';
import { INTERVIEWER_SEED } from '../server/airtable/schema.ts';

const interviewers = toConfig(
  INTERVIEWER_SEED.map((r) => ({ name: r.Name, aliases: r.Aliases, geoPool: r['Geo Pool'] })),
);

// [title, interviewDate] — date drives the two-Shubham disambiguation rule.
const cases: [string, string | null][] = [
  ['R2 | SDR - US | Amit Tripathy <> Asad Mansuri | Leena.ai', null],
  ['R1 | SDR - Europe | Chinar <> Robin Dhilip | Leena.ai', null],          // interviewer on LEFT (swapped)
  ['Cultural | SDR - US | Pooja Singh <> Jayeeta | Leena.ai', null],         // cultural round, Jayeeta
  ['R1 | SDR - US | Priya Sharma <> Nick | Leena.ai', null],                 // Nick -> Nikhil
  ['R2 | SDR - US | John Doe <> Shubham G | Leena.ai', null],                // alias -> Shubham Gill
  ['R2 | SDR - US | Jane Roe <> Shubham | Leena.ai', '2026-06-05T10:00:00Z'],// rule -> Mittal (before cutoff)
  ['R2 | SDR - US | Jane Roe <> Shubham | Leena.ai', '2026-06-20T10:00:00Z'],// rule -> Gill (on/after cutoff)
  ['R2 | SDR - US | Jane Roe <> Shubham | Leena.ai', null],                  // no date -> ambiguous, review
  ['[Rescheduled] R2 | SDR - US | Maria Merlin <> Shravan | Leena.ai', null],// rescheduled prefix
  ['R1 | SDR - Europe | sourabh kalas <> Akshey | Leena.ai', null],         // fuzzy: Akshey -> Akshay (now review)
  ['R1 | PM - India | Foo Bar <> Someone Else | Leena.ai', null],           // out-of-scope role + unmatched
  ['Catch up with Asad', null],                                             // unrecognized format
];

for (const [title, date] of cases) {
  const p = parseEventTitle(title, interviewers, date);
  console.log('\n' + title + (date ? `   [${date.slice(0, 10)}]` : ''));
  console.log('  ', JSON.stringify({
    round: p.round, role: p.role, geo: p.geo, inScope: p.inScope,
    candidate: p.candidateName, interviewer: p.interviewer, matched: p.matched,
    rescheduled: p.rescheduled, needsReview: p.needsReview, reason: p.reason,
  }));
}
console.log('\n--- done ---');
