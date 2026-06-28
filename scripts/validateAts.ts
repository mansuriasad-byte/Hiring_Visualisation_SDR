import { readFileSync } from 'node:fs';
import { parseAtsExport } from '../server/services/parsers/ats.ts';

const content = readFileSync(process.argv[2], 'utf8');
const res = parseAtsExport(content, { role: 'SDR', geo: 'US', fileName: 'real-ats.csv' });

console.log('STATS:', JSON.stringify(res.stats, null, 2));

const tally = (key: (r: any) => string) => {
  const m = new Map<string, number>();
  for (const r of res.records) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
};

console.log('\nflag:', tally(r => r.flag ?? '(kept)'));
console.log('role:', tally(r => `${r.role}`));
console.log('geo:', tally(r => `${r.geo}`));
console.log('scope:', tally(r => r.inScope ? 'inScope' : 'out'));
console.log('source:', tally(r => `${r.source}`));

const kept = res.records.filter(r => !r.flag);
console.log('\nstage (kept):', tally2(kept, r => `${r.currentStage}`));
console.log('status (kept):', tally2(kept, r => `${r.status}`));

// unmapped pipeline values (would default to Applied)
const unmapped = new Set<string>();
for (const r of kept) {
  if (r.pipelineRaw && r.currentStage === 'Applied' && r.pipelineRaw.toLowerCase() !== 'applied') {
    unmapped.add(r.pipelineRaw);
  }
}
console.log('\nUNMAPPED pipeline values (defaulted to Applied):', [...unmapped]);

// date parse failures among kept rows
const badDates = kept.filter(r => !r.dateApplied).length;
console.log('kept rows with no parsed dateApplied:', badDates, '/', kept.length);

console.log('\nSample in-scope SDR-US records:');
for (const r of kept.filter(r => r.inScope).slice(0, 5)) {
  console.log(' ', JSON.stringify({ name: r.name, email: r.email, role: r.role, geo: r.geo, stage: r.currentStage, status: r.status, raw: r.pipelineRaw, date: r.dateApplied, source: r.source }));
}

function tally2(arr: any[], key: (r: any) => string) {
  const m = new Map<string, number>();
  for (const r of arr) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}
