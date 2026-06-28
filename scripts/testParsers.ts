import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAtsExport } from '../server/services/parsers/ats.ts';
import { parseReferralDump } from '../server/services/parsers/referral.ts';
import { parseOfferStatus } from '../server/services/parsers/offer.ts';
import type { ParseResult } from '../server/types.ts';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const read = (f: string) => readFileSync(resolve(fixtures, f), 'utf-8');

function report(title: string, r: ParseResult, sampleKeys: (keyof any)[]) {
  console.log(`\n=== ${title} ===`);
  console.log('stats:', JSON.stringify(r.stats, null, 2));
  console.log('samples:');
  for (const rec of r.records.slice(0, 3)) {
    const picked: Record<string, unknown> = {};
    for (const k of sampleKeys) picked[k as string] = (rec as any)[k];
    console.log('  ', JSON.stringify(picked));
  }
}

// 1) ATS export (role/geo chosen on upload)
const ats = parseAtsExport(read('ats_sdr_na.csv'), { role: 'SDR', geo: 'US', fileName: 'ats_sdr_na.csv' });
report('ATS  (role=SDR, geo=US)', ats, ['name', 'email', 'role', 'geo', 'inScope', 'source', 'currentStage', 'dateApplied', 'currentCtc']);

// 2) Referral dump (all roles, scope tagged)
const ref = parseReferralDump(read('referrals.csv'), 'referrals.csv');
report('REFERRAL  (all roles)', ref, ['name', 'email', 'role', 'geo', 'inScope', 'disposition', 'status', 'referrer', 'flag']);
console.log('\n  flagged rows (test/junk/bad email):');
for (const rec of ref.records.filter((r) => r.flag)) {
  console.log(`   - [${rec.flag}] name="${rec.name}" email="${rec.email}" (${rec.referralId})`);
}

// 3) Offer/join status (update-only)
const off = parseOfferStatus(read('offers.csv'), 'offers.csv');
report('OFFER  (update-only)', off, ['name', 'email', 'status', 'offerDate', 'joinDate', 'updateOnly']);

console.log('\n--- done ---');
