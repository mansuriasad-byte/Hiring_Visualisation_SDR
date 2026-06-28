import type { UploadType, CandidateRecord } from '../types.ts';
import { parseAtsExport } from './parsers/ats.ts';
import { parseReferralDump } from './parsers/referral.ts';
import { parseOfferStatus } from './parsers/offer.ts';
import { toAirtableFields } from '../airtable/schema.ts';
import {
  airtableConfigured, upsertCandidates, findCandidateIdsByEmail,
  updateCandidatesById, createUploadBatch,
} from '../airtable/client.ts';

export interface IngestOptions {
  type: UploadType;
  fileName: string;
  role?: string; // required for ats
  geo?: string; // required for ats
}

export interface IngestSummary {
  dryRun: boolean;
  type: UploadType;
  stats: ReturnType<typeof parseAtsExport>['stats'];
  write: {
    created: number;
    updated: number;
    skippedFlagged: number;
    unmatched?: number; // offer rows with no existing candidate
  };
}

/**
 * Collapse records that share an email (case-insensitive) into one, merging
 * fields so later non-empty values win. Airtable rejects a batch that updates
 * the same upserted record twice, and a referral export legitimately lists the
 * same candidate more than once (re-referrals, duplicate-of columns).
 * Records without an email are left untouched.
 */
export function dedupeByEmail(records: CandidateRecord[]): CandidateRecord[] {
  const byEmail = new Map<string, CandidateRecord>();
  const out: CandidateRecord[] = [];
  for (const r of records) {
    const key = r.email?.toLowerCase();
    if (!key) { out.push(r); continue; }
    const existing = byEmail.get(key);
    if (!existing) { byEmail.set(key, r); out.push(r); continue; }
    for (const [k, v] of Object.entries(r)) {
      if (v !== null && v !== undefined && v !== '') (existing as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function parseByType(type: UploadType, content: string, opts: IngestOptions) {
  switch (type) {
    case 'ats':
      return parseAtsExport(content, { role: opts.role!, geo: opts.geo!, fileName: opts.fileName });
    case 'referral':
      return parseReferralDump(content, opts.fileName);
    case 'offer':
      return parseOfferStatus(content, opts.fileName);
  }
}

export async function ingest(content: string, opts: IngestOptions): Promise<IngestSummary> {
  const parsed = parseByType(opts.type, content, opts);
  const usable = dedupeByEmail(parsed.records.filter((r) => !r.flag));
  const skippedFlagged = parsed.records.length - parsed.records.filter((r) => !r.flag).length;
  const uploadedAt = new Date().toISOString();
  const configured = airtableConfigured();

  const write: IngestSummary['write'] = { created: 0, updated: 0, skippedFlagged };

  if (!configured) {
    // Dry run: report what *would* be written so the pipeline is testable
    // before an Airtable token is configured.
    return { dryRun: true, type: opts.type, stats: parsed.stats, write };
  }

  if (opts.type === 'offer') {
    const emails = usable.map((r) => r.email).filter((e): e is string => !!e);
    const idMap = await findCandidateIdsByEmail(emails);
    const updates = usable
      .filter((r) => r.email && idMap.has(r.email))
      .map((r) => ({ id: idMap.get(r.email!)!, fields: toAirtableFields(r, uploadedAt) }));
    write.updated = await updateCandidatesById(updates);
    write.unmatched = usable.length - updates.length;
  } else {
    const fields = usable.map((r) => toAirtableFields(r, uploadedAt));
    const res = await upsertCandidates(fields, ['Email']);
    write.created = res.created;
    write.updated = res.updated;
  }

  await createUploadBatch({
    File: opts.fileName,
    Type: opts.type,
    'Uploaded At': uploadedAt,
    Role: opts.role ?? '',
    Geo: opts.geo ?? '',
    'Total Rows': parsed.stats.totalRows,
    Parsed: parsed.stats.parsed,
    'In Scope': parsed.stats.inScope,
    Created: write.created,
    Updated: write.updated,
    Flagged: skippedFlagged,
  });

  return { dryRun: false, type: opts.type, stats: parsed.stats, write };
}
