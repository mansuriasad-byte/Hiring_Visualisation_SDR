// Minimal Airtable REST client (uses global fetch; no SDK dependency).
const API = 'https://api.airtable.com/v0';

export function airtableConfigured(): boolean {
  return Boolean(process.env.AIRTABLE_PAT && process.env.AIRTABLE_BASE_ID);
}

function cfg() {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) throw new Error('AIRTABLE_PAT and AIRTABLE_BASE_ID must be set');
  return { pat, baseId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Inter-batch pacing. Kept well under the corporate proxy's burst threshold so a
// full rebuild (~100 deletes + ~130 upsert batches) doesn't trip a Zscaler block.
const PACE_MS = 450;

const RETRIES = 5; // attempts after the first try
const jitter = () => Math.floor(Math.random() * 250);
// Network/5xx blips clear fast: 0.5s..8s.
const backoff = (attempt: number) => 500 * 2 ** attempt + jitter();
// Corporate-proxy (Zscaler) throttle on a request burst lasts much longer and
// needs a patient cooldown to let its rate window reset: 5s, 10s, 20s, 40s, 60s.
const proxyBackoff = (attempt: number) => Math.min(60_000, 5_000 * 2 ** attempt) + jitter();

/**
 * Single Airtable REST call with retry on transient failures: network errors
 * (fetch throws), 429 rate-limits, 5xx, and proxy throttle blocks (403 + HTML
 * body from Zscaler). Honors Retry-After; otherwise exponential backoff — short
 * for blips, long for proxy throttling. Genuine 4xx (JSON) surface immediately.
 */
async function call(method: string, path: string, body?: unknown): Promise<any> {
  const { pat } = cfg();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return res.status === 204 ? null : res.json();

      const text = await res.text();
      // A genuine Airtable error is JSON; an HTML body on a 4xx is the corporate
      // proxy (Zscaler) intermittently blocking a burst of writes — treat as transient.
      const proxyBlock = /^\s*</.test(text) || !/json/i.test(res.headers.get('content-type') ?? '');
      const retriable = res.status === 429 || res.status >= 500 || (res.status === 403 && proxyBlock);
      if (!retriable || attempt === RETRIES) {
        const snippet = proxyBlock ? '[proxy/HTML body]' : text;
        throw new Error(`Airtable ${method} ${path} -> ${res.status}: ${snippet}`);
      }
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      const wait = retryAfter > 0 ? retryAfter : (proxyBlock ? proxyBackoff(attempt) : backoff(attempt));
      console.warn(`Airtable ${method} ${path} -> ${res.status}${proxyBlock ? ' [proxy throttle]' : ''}; retry ${attempt + 1}/${RETRIES} in ${wait}ms`);
      await sleep(wait);
    } catch (err) {
      // HTTP errors thrown above are non-retriable past this point; re-throw.
      if (err instanceof Error && err.message.startsWith('Airtable ')) throw err;
      // Network-level failure (fetch rejected): retry with backoff.
      lastErr = err;
      if (attempt === RETRIES) break;
      const wait = backoff(attempt);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Airtable ${method} ${path} network error (${msg}); retry ${attempt + 1}/${RETRIES} in ${wait}ms`);
      await sleep(wait);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Airtable ${method} ${path} failed after ${RETRIES} retries: ${msg}`);
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
const enc = (s: string) => encodeURIComponent(s);

export interface UpsertResult { created: number; updated: number; }

/**
 * Upsert candidate rows, merging on the given field(s) (default Email).
 * Batches of 10 at ~5 req/s to stay within Airtable limits.
 */
export async function upsertCandidates(
  fields: Record<string, unknown>[],
  mergeOn: string[] = ['Email'],
): Promise<UpsertResult> {
  const { baseId } = cfg();
  let created = 0;
  let updated = 0;
  for (const batch of chunk(fields, 10)) {
    const res = await call('PATCH', `/${baseId}/${enc('Candidates')}`, {
      performUpsert: { fieldsToMergeOn: mergeOn },
      records: batch.map((f) => ({ fields: f })),
      typecast: true,
    });
    created += (res.createdRecords?.length as number) ?? 0;
    updated += (res.updatedRecords?.length as number) ?? 0;
    await sleep(PACE_MS);
  }
  return { created, updated };
}

/** Look up existing Candidate record IDs by email (for update-only files). */
export async function findCandidateIdsByEmail(emails: string[]): Promise<Map<string, string>> {
  const { baseId } = cfg();
  const map = new Map<string, string>();
  for (const batch of chunk(emails, 50)) {
    const formula = `OR(${batch.map((e) => `LOWER({Email})='${e.replace(/'/g, "\\'")}'`).join(',')})`;
    const res = await call(
      'GET',
      `/${baseId}/${enc('Candidates')}?filterByFormula=${enc(formula)}&fields%5B%5D=Email&pageSize=100`,
    );
    for (const rec of res.records ?? []) {
      const email = String(rec.fields?.Email ?? '').toLowerCase();
      if (email) map.set(email, rec.id);
    }
    await sleep(PACE_MS);
  }
  return map;
}

/** Update existing records by ID (used by offer/join files; never creates). */
export async function updateCandidatesById(
  updates: { id: string; fields: Record<string, unknown> }[],
): Promise<number> {
  const { baseId } = cfg();
  let updated = 0;
  for (const batch of chunk(updates, 10)) {
    const res = await call('PATCH', `/${baseId}/${enc('Candidates')}`, {
      records: batch,
      typecast: true,
    });
    updated += (res.records?.length as number) ?? 0;
    await sleep(PACE_MS);
  }
  return updated;
}

export interface AirtableRecord { id: string; fields: Record<string, any>; }

/** List records from any table, with optional field projection + filter formula. */
export async function listRecords(
  table: string,
  opts: { fields?: string[]; filter?: string } = {},
): Promise<AirtableRecord[]> {
  const { baseId } = cfg();
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  const fieldQs = (opts.fields ?? []).map((f) => `&fields%5B%5D=${enc(f)}`).join('');
  const filterQs = opts.filter ? `&filterByFormula=${enc(opts.filter)}` : '';
  do {
    const res = await call('GET', `/${baseId}/${enc(table)}?pageSize=100${fieldQs}${filterQs}${offset ? `&offset=${offset}` : ''}`);
    out.push(...(res.records ?? []));
    offset = res.offset;
    if (offset) await sleep(PACE_MS);
  } while (offset);
  return out;
}

/** Patch a single record's fields by id. Returns the updated record. */
export async function updateRecord(
  table: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const { baseId } = cfg();
  const res = await call('PATCH', `/${baseId}/${enc(table)}/${enc(id)}`, { fields, typecast: true });
  return res as AirtableRecord;
}

/** Delete every record in a table (batches of 10). Returns count deleted. */
export async function deleteAllRecords(table: string): Promise<number> {
  const { baseId } = cfg();
  const recs = await listAll(table, []);
  const ids = recs.map((r) => r.id);
  let deleted = 0;
  for (const batch of chunk(ids, 10)) {
    const qs = batch.map((id) => `records%5B%5D=${enc(id)}`).join('&');
    const res = await call('DELETE', `/${baseId}/${enc(table)}?${qs}`);
    deleted += (res?.records?.length as number) ?? batch.length;
    await sleep(PACE_MS);
  }
  return deleted;
}

export async function createUploadBatch(fields: Record<string, unknown>): Promise<void> {
  const { baseId } = cfg();
  await call('POST', `/${baseId}/${enc('Upload Batches')}`, { records: [{ fields }], typecast: true });
}

// ---------------------------------------------------------------------------
// Calendar sync helpers
// ---------------------------------------------------------------------------

async function listAll(table: string, fields?: string[]): Promise<{ id: string; fields: any }[]> {
  const { baseId } = cfg();
  const out: { id: string; fields: any }[] = [];
  let offset: string | undefined;
  const fieldQs = (fields ?? []).map((f) => `&fields%5B%5D=${enc(f)}`).join('');
  do {
    const res = await call('GET', `/${baseId}/${enc(table)}?pageSize=100${fieldQs}${offset ? `&offset=${offset}` : ''}`);
    out.push(...(res.records ?? []));
    offset = res.offset;
    if (offset) await sleep(PACE_MS);
  } while (offset);
  return out;
}

export interface InterviewerRow { name: string; aliases: string | null; geoPool: string | null; }
export async function listInterviewers(): Promise<InterviewerRow[]> {
  const recs = await listAll('Interviewers', ['Name', 'Aliases', 'Geo Pool', 'Active']);
  return recs
    .filter((r) => r.fields.Active !== false && r.fields.Name && String(r.fields.Name).trim())
    .map((r) => ({ name: r.fields.Name, aliases: r.fields.Aliases ?? null, geoPool: r.fields['Geo Pool'] ?? null }));
}

export interface CalendarSourceRow { id: string; name: string; email: string | null; type: string | null; lastSynced: string | null; }
export async function listCalendarSources(): Promise<CalendarSourceRow[]> {
  const recs = await listAll('Calendar Sources', ['Name', 'Email', 'Type', 'Active', 'Last Synced']);
  return recs
    .filter((r) => r.fields.Active !== false)
    .map((r) => ({ id: r.id, name: r.fields.Name, email: r.fields.Email ?? null, type: r.fields.Type ?? null, lastSynced: r.fields['Last Synced'] ?? null }));
}

export async function touchCalendarSource(id: string, lastSynced: string): Promise<void> {
  const { baseId } = cfg();
  await call('PATCH', `/${baseId}/${enc('Calendar Sources')}`, {
    records: [{ id, fields: { 'Last Synced': lastSynced } }],
  });
}

/** Lowercased email set + normalized-name set of existing candidates, for matching. */
export async function loadCandidateKeys(): Promise<{ emails: Set<string>; names: Set<string> }> {
  const recs = await listAll('Candidates', ['Email', 'Name']);
  const emails = new Set<string>();
  const names = new Set<string>();
  for (const r of recs) {
    if (r.fields.Email) emails.add(String(r.fields.Email).toLowerCase());
    if (r.fields.Name) names.add(String(r.fields.Name).trim().toLowerCase());
  }
  return { emails, names };
}

/** Upsert interviews, merging on iCalUID (dedups the same event across calendars). */
export async function upsertInterviews(fields: Record<string, unknown>[]): Promise<UpsertResult> {
  const { baseId } = cfg();
  let created = 0;
  let updated = 0;
  for (const batch of chunk(fields, 10)) {
    const res = await call('PATCH', `/${baseId}/${enc('Interviews')}`, {
      performUpsert: { fieldsToMergeOn: ['iCalUID'] },
      records: batch.map((f) => ({ fields: f })),
      typecast: true,
    });
    created += (res.createdRecords?.length as number) ?? 0;
    updated += (res.updatedRecords?.length as number) ?? 0;
    await sleep(PACE_MS);
  }
  return { created, updated };
}
