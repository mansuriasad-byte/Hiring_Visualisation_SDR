import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../server/services/csv.ts';
import { parseAtsExport } from '../server/services/parsers/ats.ts';
import { parseReferralDump } from '../server/services/parsers/referral.ts';
import { dedupeByEmail } from '../server/services/ingest.ts';
import { normalizeSource } from '../server/services/normalize.ts';
import { toAirtableFields } from '../server/airtable/schema.ts';
import type { CandidateRecord } from '../server/types.ts';

// Rebuild the candidate list exactly like rebuildCandidates.ts, then probe the
// Airtable PATCH endpoint batch-by-batch to find which batch (if any) the
// corporate proxy blocks — and dump that batch's payload for inspection.
const DL = '/Users/asadmansuri/Downloads/';
const ATS_FILES: { file: string; geo: 'US' | 'Europe' }[] = [
  { file: 'Untitled spreadsheet - US.csv', geo: 'US' },
  { file: 'Untitled spreadsheet - US-2.csv', geo: 'US' },
  { file: 'Untitled spreadsheet - Sales Development Representative (SDR)— North America (1).csv', geo: 'US' },
  { file: 'Untitled spreadsheet - Europe.csv', geo: 'Europe' },
  { file: 'Untitled spreadsheet - Senior Sales Development Representative(SDR)- Europe.csv', geo: 'Europe' },
  { file: 'Untitled spreadsheet - Senior Sales Development Representative(SDR)- Europe (1).csv', geo: 'Europe' },
];
const BIG_DUMP = 'ATS Dump Part 1.csv';
const REFERRAL = 'Employee Referral_Total_Summary (4).csv';

function buildCandidates(): CandidateRecord[] {
  const cleaned = new Map<string, string>();
  for (const r of parseCsv(readFileSync(DL + BIG_DUMP, 'utf8')).rows) {
    const e = (r['email'] ?? '').trim().toLowerCase();
    const cs = (r['Cleaned Source'] ?? '').trim();
    if (e && cs) cleaned.set(e, cs);
  }
  const all: CandidateRecord[] = [];
  for (const { file, geo } of ATS_FILES) {
    const res = parseAtsExport(readFileSync(DL + file, 'utf8'), { role: 'SDR', geo, fileName: file });
    for (const rec of res.records.filter((r) => !r.flag)) {
      const e = rec.email?.toLowerCase();
      if (e && cleaned.has(e)) rec.source = normalizeSource(cleaned.get(e));
      all.push(rec);
    }
  }
  let candidates = dedupeByEmail(all);
  const refUsable = parseReferralDump(readFileSync(DL + REFERRAL, 'utf8'), REFERRAL).records.filter((r) => !r.flag && r.email);
  const byEmail = new Map(candidates.map((r) => [r.email!.toLowerCase(), r]));
  for (const ref of refUsable) {
    const existing = byEmail.get(ref.email!.toLowerCase());
    if (existing) {
      existing.source = 'Referral';
      existing.referrer = ref.referrer ?? existing.referrer;
      existing.referralStatus = ref.referralStatus ?? existing.referralStatus;
      existing.disposition = existing.disposition ?? ref.disposition;
    } else if (ref.inScope) candidates.push(ref);
  }
  return dedupeByEmail(candidates);
}

const chunk = <T>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const base = process.env.AIRTABLE_BASE_ID!;
  const pat = process.env.AIRTABLE_PAT!;
  const H = { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' };
  const uploadedAt = new Date().toISOString();
  const candidates = buildCandidates();
  const fields = candidates.map((r) => toAirtableFields(r, uploadedAt));
  console.log(`Built ${fields.length} candidates; probing PATCH batch-by-batch (no delete)…`);

  const batches = chunk(fields, 10);
  for (let i = 0; i < batches.length; i++) {
    const body = JSON.stringify({ performUpsert: { fieldsToMergeOn: ['Email'] }, records: batches[i].map((f) => ({ fields: f })), typecast: true });
    const r = await fetch(`https://api.airtable.com/v0/${base}/Candidates`, { method: 'PATCH', headers: H, body });
    if (r.status !== 200) {
      const t = await r.text();
      const proxy = /^\s*</.test(t);
      console.log(`\n❌ batch ${i} (records ${i * 10}-${i * 10 + batches[i].length - 1}) -> ${r.status} ${proxy ? '[PROXY/HTML BLOCK]' : ''}`);
      console.log('Emails in blocked batch:', batches[i].map((f: any) => f.Email).join(', '));
      console.log('\nBatch payload (field keys + value lengths):');
      for (const f of batches[i] as any[]) {
        const summary = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? `"${String(v).slice(0, 50)}"${String(v).length > 50 ? `…(${String(v).length})` : ''}` : v]));
        console.log(' -', JSON.stringify(summary));
      }
      if (!proxy) console.log('\nAirtable said:', t.slice(0, 300));
      process.exit(2);
    }
    if (i % 10 === 0) console.log(`  ok through batch ${i} (${i * 10} records)`);
    await sleep(450);
  }
  console.log(`\n✅ All ${batches.length} batches accepted — upsert is NOT blocked when run this way.`);
}
main().catch((e) => { console.error('probe error:', e.message); process.exit(1); });
