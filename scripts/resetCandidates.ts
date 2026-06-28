import 'dotenv/config';
import { airtableConfigured, deleteAllRecords } from '../server/airtable/client.ts';

/**
 * Wipe candidate data so a fresh load starts clean. By default clears the
 * Candidates and Upload Batches tables only — Interviews, Interviewers and
 * Calendar Sources are left untouched (the 488 synced interviews stay).
 *
 *   npm run reset:candidates            # dry run, prints what it would delete
 *   npm run reset:candidates -- --yes   # actually delete
 *   npm run reset:candidates -- --yes --tables Candidates
 */
async function main() {
  if (!airtableConfigured()) {
    console.error('AIRTABLE_PAT / AIRTABLE_BASE_ID missing in .env — nothing to do.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const confirm = args.includes('--yes');
  const tablesArg = args.indexOf('--tables');
  const tables = tablesArg !== -1
    ? args.slice(tablesArg + 1).filter((a) => !a.startsWith('--'))
    : ['Candidates', 'Upload Batches'];

  if (!confirm) {
    console.log(`DRY RUN — would delete ALL records from: ${tables.join(', ')}`);
    console.log('Re-run with `-- --yes` to perform the deletion.');
    return;
  }

  for (const table of tables) {
    const n = await deleteAllRecords(table);
    console.log(`✓ deleted ${n} record(s) from "${table}"`);
  }
  console.log('\nReset complete.');
}

main().catch((err) => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
