import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import Papa from 'papaparse';
import { ATS_PIPELINE } from '../server/services/normalize.ts';

/**
 * Export the things you should eyeball + correct:
 *   1. exports/review-interviews.csv — every interview flagged Needs Review,
 *      with blank correction columns to fill in.
 *   2. exports/pipeline-stage-map.csv — how each raw ATS pipeline value maps to
 *      canonical stage + status, with blank columns to override.
 *
 * Annotate the "Correct *" / "Keep? (y/n)" columns and hand the files back; I
 * turn them into matcher rules / panel edits.
 */
const pat = process.env.AIRTABLE_PAT!;
const base = process.env.AIRTABLE_BASE_ID!;
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listAll(table: string, fields: string[], filter?: string) {
  const out: any[] = [];
  let offset = '';
  const fq = fields.map((f) => `&fields%5B%5D=${enc(f)}`).join('');
  const ff = filter ? `&filterByFormula=${enc(filter)}` : '';
  do {
    const r = await fetch(
      `https://api.airtable.com/v0/${base}/${enc(table)}?pageSize=100${fq}${ff}${offset ? `&offset=${offset}` : ''}`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.records ?? []));
    offset = j.offset ?? '';
    if (offset) await sleep(210);
  } while (offset);
  return out;
}

async function main() {
  mkdirSync('exports', { recursive: true });

  // 1. Review interviews
  const cols = ['Raw Title', 'Interview Date', 'Round', 'Role', 'Geo', 'In Scope',
    'Candidate Name', 'Candidate Email', 'Interviewer', 'Interviewer Matched',
    'Confidence', 'Matched By', 'Review Reason', 'iCalUID'];
  const recs = await listAll('Interviews', cols, '{Needs Review}=1');
  recs.sort((a, b) => String(a.fields['Interview Date'] ?? '').localeCompare(String(b.fields['Interview Date'] ?? '')));
  const reviewRows = recs.map((r) => {
    const f = r.fields;
    return {
      'Interview Date': f['Interview Date'] ?? '',
      'Raw Title': f['Raw Title'] ?? '',
      Round: f['Round'] ?? '',
      'Role/Geo': `${f['Role'] ?? ''} ${f['Geo'] ?? ''}`.trim(),
      'In Scope': f['In Scope'] ? 'yes' : 'no',
      'Parsed Candidate': f['Candidate Name'] ?? '',
      'Candidate Email': f['Candidate Email'] ?? '',
      'Parsed Interviewer': f['Interviewer'] ?? '',
      Confidence: f['Confidence'] ?? '',
      'Matched By': f['Matched By'] ?? '',
      'Review Reason': f['Review Reason'] ?? '',
      // ---- fill these in ----
      'Is Interview? (y/n)': '',
      'Correct Interviewer': '',
      'Correct Candidate': '',
      'Correct Round': '',
      Notes: '',
      iCalUID: f['iCalUID'] ?? '', // key — leave as-is
    };
  });
  writeFileSync('exports/review-interviews.csv', Papa.unparse(reviewRows));
  console.log(`✓ exports/review-interviews.csv (${reviewRows.length} rows)`);

  // 2. Pipeline -> stage/status map
  const mapRows = Object.entries(ATS_PIPELINE).map(([key, v]) => ({
    'Pipeline value (normalized key)': key,
    'Mapped Stage': v.stage,
    'Mapped Status': v.status,
    // ---- override if wrong ----
    'Correct Stage': '',
    'Correct Status': '',
    Notes: '',
  }));
  writeFileSync('exports/pipeline-stage-map.csv', Papa.unparse(mapRows));
  console.log(`✓ exports/pipeline-stage-map.csv (${mapRows.length} rows)`);
}

main().catch((err) => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
