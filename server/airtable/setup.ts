import 'dotenv/config';
import { TABLES, INTERVIEWER_SEED, CALENDAR_SOURCE_SEED } from './schema.ts';

// Creates/updates the base structure via the Airtable Metadata API.
// Idempotent: creates only missing tables and missing fields, then seeds
// interviewers if the table is empty.
const API = 'https://api.airtable.com/v0';

function cfg() {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) {
    console.error('Missing AIRTABLE_PAT / AIRTABLE_BASE_ID in environment (.env).');
    process.exit(1);
  }
  return { pat, baseId };
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const { pat } = cfg();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function run() {
  const { baseId } = cfg();
  const existing = await call('GET', `/meta/bases/${baseId}/tables`);
  const byName = new Map<string, any>((existing.tables ?? []).map((t: any) => [t.name, t]));

  for (const table of TABLES) {
    const found = byName.get(table.name);
    if (!found) {
      await call('POST', `/meta/bases/${baseId}/tables`, { name: table.name, fields: table.fields });
      console.log(`✓ created table "${table.name}" (${table.fields.length} fields)`);
    } else {
      const haveFields = new Set((found.fields ?? []).map((f: any) => f.name));
      let added = 0;
      for (const field of table.fields) {
        if (haveFields.has(field.name)) continue;
        await call('POST', `/meta/bases/${baseId}/tables/${found.id}/fields`, field);
        added++;
      }
      console.log(`✓ table "${table.name}" exists${added ? ` (added ${added} missing field(s))` : ''}`);
    }
  }

  // Seed interviewers only when empty.
  const rows = await call('GET', `/${baseId}/${encodeURIComponent('Interviewers')}?pageSize=1`);
  if (!rows.records?.length) {
    await call('POST', `/${baseId}/${encodeURIComponent('Interviewers')}`, {
      records: INTERVIEWER_SEED.map((fields) => ({ fields })),
      typecast: true,
    });
    console.log(`✓ seeded ${INTERVIEWER_SEED.length} interviewers`);
  } else {
    console.log('✓ interviewers already present, skipping seed');
  }

  // Seed calendar sources (TA coordinators) only when empty.
  const sources = await call('GET', `/${baseId}/${encodeURIComponent('Calendar Sources')}?pageSize=1`);
  if (!sources.records?.length) {
    await call('POST', `/${baseId}/${encodeURIComponent('Calendar Sources')}`, {
      records: CALENDAR_SOURCE_SEED.map((fields) => ({ fields })),
      typecast: true,
    });
    console.log(`✓ seeded ${CALENDAR_SOURCE_SEED.length} calendar sources (add their Email in Airtable)`);
  } else {
    console.log('✓ calendar sources already present, skipping seed');
  }

  console.log('\nAirtable base is ready.');
}

run().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
