import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../server/services/csv.ts';
import { parseAtsExport } from '../server/services/parsers/ats.ts';
import { parseReferralDump } from '../server/services/parsers/referral.ts';
import { dedupeByEmail } from '../server/services/ingest.ts';
import { normalizeSource } from '../server/services/normalize.ts';
import { toAirtableFields } from '../server/airtable/schema.ts';
import { airtableConfigured, upsertCandidates, deleteAllRecords } from '../server/airtable/client.ts';
import type { CandidateRecord } from '../server/types.ts';

/**
 * Rebuild the central Candidates table from the per-role SDR ATS sheets:
 *   union all sheets -> dedup by email -> recover curated `Cleaned Source`
 *   (incl. the "Sourced" tag) from the big dump by email -> overlay referral
 *   (flip matched candidates' source to Referral + attach referrer; add
 *   in-scope referral-only candidates).
 *
 *   npm run rebuild:candidates -- --dry   # parse + report, no writes
 *   npm run rebuild:candidates -- --yes   # reset Candidates/Upload Batches + load
 */
const DL = '/Users/asadmansuri/Downloads/';

// Per-role SDR exports (file = requisition). geo drives scope; role = SDR.
const ATS_FILES: { file: string; geo: 'US' | 'Europe' }[] = [
  { file: 'Untitled spreadsheet - US.csv', geo: 'US' },
  { file: 'Untitled spreadsheet - US-2.csv', geo: 'US' },
  { file: 'Untitled spreadsheet - Sales Development Representative (SDR)— North America (1).csv', geo: 'US' },
  { file: 'Untitled spreadsheet - Europe.csv', geo: 'Europe' },
  { file: 'Untitled spreadsheet - Senior Sales Development Representative(SDR)- Europe.csv', geo: 'Europe' },
  { file: 'Untitled spreadsheet - Senior Sales Development Representative(SDR)- Europe (1).csv', geo: 'Europe' },
];
const BIG_DUMP = 'ATS Dump Part 1.csv'; // has Cleaned Source — used only for enrichment
const REFERRAL = 'Employee Referral_Total_Summary (4).csv';

const tally = (recs: CandidateRecord[], key: (r: CandidateRecord) => string) => {
  const m: Record<string, number> = {};
  for (const r of recs) { const k = key(r) || '(none)'; m[k] = (m[k] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};

async function main() {
  const dry = process.argv.includes('--dry');
  const confirmed = process.argv.includes('--yes');

  // 1. Cleaned Source lookup (email -> curated source) from the big dump.
  const cleaned = new Map<string, string>();
  for (const r of parseCsv(readFileSync(DL + BIG_DUMP, 'utf8')).rows) {
    const e = (r['email'] ?? '').trim().toLowerCase();
    const cs = (r['Cleaned Source'] ?? '').trim();
    if (e && cs) cleaned.set(e, cs);
  }
  console.log(`Cleaned Source lookup: ${cleaned.size} emails from ${BIG_DUMP}`);

  // 2. Parse + enrich each per-role sheet.
  const all: CandidateRecord[] = [];
  for (const { file, geo } of ATS_FILES) {
    const res = parseAtsExport(readFileSync(DL + file, 'utf8'), { role: 'SDR', geo, fileName: file });
    const usable = res.records.filter((r) => !r.flag);
    let enriched = 0;
    for (const rec of usable) {
      const e = rec.email?.toLowerCase();
      if (e && cleaned.has(e)) { rec.source = normalizeSource(cleaned.get(e)); enriched++; }
    }
    all.push(...usable);
    console.log(`  ${file} -> ${usable.length} usable (${enriched} source-enriched)`);
  }

  // 3. Dedup across all sheets.
  let candidates = dedupeByEmail(all);
  console.log(`\nUnioned + deduped ATS candidates: ${candidates.length}`);

  // 4. Referral overlay.
  const refUsable = parseReferralDump(readFileSync(DL + REFERRAL, 'utf8'), REFERRAL)
    .records.filter((r) => !r.flag && r.email);
  const byEmail = new Map(candidates.map((r) => [r.email!.toLowerCase(), r]));
  let flipped = 0, refOnly = 0;
  for (const ref of refUsable) {
    const existing = byEmail.get(ref.email!.toLowerCase());
    if (existing) {
      existing.source = 'Referral';
      existing.referrer = ref.referrer ?? existing.referrer;
      existing.referralStatus = ref.referralStatus ?? existing.referralStatus;
      existing.disposition = existing.disposition ?? ref.disposition;
      flipped++;
    } else if (ref.inScope) {
      candidates.push(ref);
      refOnly++;
    }
  }
  console.log(`Referral overlay: ${flipped} flipped to Referral, ${refOnly} in-scope referral-only added`);

  // Final dedup: re-referrals can list the same email twice, and Airtable
  // rejects updating the same upserted record more than once per request.
  candidates = dedupeByEmail(candidates);

  // Report
  console.log(`\nFINAL central table: ${candidates.length} candidates`);
  console.log('In scope:', tally(candidates, (r) => (r.inScope ? 'in' : 'out')));
  console.log('Geo:', tally(candidates, (r) => String(r.geo)));
  console.log('Source:', tally(candidates, (r) => String(r.source)));
  console.log('Status:', tally(candidates, (r) => String(r.status)));

  if (dry || !confirmed) {
    console.log(`\n(${dry ? 'DRY' : 'no --yes'}) — no writes. Re-run with --yes to reset + load.`);
    return;
  }
  if (!airtableConfigured()) { console.error('Airtable not configured.'); process.exit(1); }

  const uploadedAt = new Date().toISOString();
  console.log('\nResetting Candidates + Upload Batches…');
  await deleteAllRecords('Candidates');
  await deleteAllRecords('Upload Batches');
  const res = await upsertCandidates(candidates.map((r) => toAirtableFields(r, uploadedAt)), ['Email']);
  console.log(`✓ wrote candidates: ${res.created} created, ${res.updated} updated`);
}

main().catch((err) => { console.error('Rebuild failed:', err.message); process.exit(1); });
