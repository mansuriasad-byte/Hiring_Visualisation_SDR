import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ingest } from '../server/services/ingest.ts';
import type { UploadType } from '../server/types.ts';

/**
 * CLI bulk loader — ingests a CSV straight into Airtable without the HTTP
 * server. Mirrors POST /api/uploads.
 *
 *   npm run load -- --type ats --role SDR --geo US "/path/All ATS Candidates.csv"
 *   npm run load -- --type referral "/path/referrals.csv"
 *   npm run load -- --type offer "/path/offers.csv"
 *
 * Add --dry to parse + print stats without writing to Airtable.
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const type = (flag('type') ?? 'ats') as UploadType;
  const role = flag('role') ?? 'SDR';
  const geo = flag('geo') ?? 'US';
  const dry = process.argv.includes('--dry');
  const file = process.argv[process.argv.length - 1];

  if (!file || file.startsWith('--')) {
    console.error('Usage: npm run load -- --type <ats|referral|offer> [--role SDR --geo US] [--dry] <file.csv>');
    process.exit(1);
  }

  const content = readFileSync(file, 'utf8');
  const fileName = basename(file);
  console.log(`Ingesting "${fileName}" as type=${type}${type === 'ats' ? ` role=${role} geo=${geo}` : ''}${dry ? ' (DRY)' : ''}...`);

  if (dry) {
    // Parse-only path: ingest() already dry-runs when Airtable is unconfigured,
    // but we want a dry run even when it IS configured, so temporarily blank it.
    const pat = process.env.AIRTABLE_PAT;
    delete process.env.AIRTABLE_PAT;
    const res = await ingest(content, { type, fileName, role, geo });
    if (pat) process.env.AIRTABLE_PAT = pat;
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const res = await ingest(content, { type, fileName, role, geo });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error('Load failed:', err.message);
  process.exit(1);
});
