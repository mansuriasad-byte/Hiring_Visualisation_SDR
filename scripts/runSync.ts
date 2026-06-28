import 'dotenv/config';
import { syncCalendars } from '../server/google/calendarSync.ts';

/**
 *   npm run sync -- --since 2026-04-01            # full backfill from a date
 *   npm run sync -- --since 2026-04-01 --dry      # parse only, no writes
 *   npm run sync -- --windowDays 30               # incremental (uses cursor)
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const since = flag('since');
  const windowDays = flag('windowDays') ? Number(flag('windowDays')) : undefined;
  const forwardDays = flag('forwardDays') ? Number(flag('forwardDays')) : undefined;
  const dryRun = process.argv.includes('--dry');

  const res = await syncCalendars({ since, windowDays, forwardDays, dryRun });
  // Trim the verbose sample for console readability.
  const { sample, ...rest } = res;
  console.log(JSON.stringify(rest, null, 2));
  console.log('\nSample:');
  for (const s of sample) console.log(' ', JSON.stringify(s));
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
