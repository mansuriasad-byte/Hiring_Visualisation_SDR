import Papa from 'papaparse';
import type { CandidateRecord, ParseResult, UploadType } from '../types.ts';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(content: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  return { headers: result.meta.fields ?? [], rows: result.data };
}

/** Pick the first non-empty value among several possible column names. */
export function firstNonEmpty(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Roll a list of parsed records into a ParseResult with summary stats. */
export function buildResult(
  type: UploadType,
  totalRows: number,
  records: CandidateRecord[],
): ParseResult {
  const flagged = { test: 0, no_email: 0, bad_email: 0 };
  const byRoleGeo: Record<string, number> = {};
  let parsed = 0;
  let inScope = 0;

  for (const r of records) {
    if (r.flag) {
      flagged[r.flag]++;
      continue;
    }
    parsed++;
    if (r.inScope) inScope++;
    const key = `${r.role ?? 'Unknown'} - ${r.geo ?? 'Unknown'}`;
    byRoleGeo[key] = (byRoleGeo[key] ?? 0) + 1;
  }

  return { type, records, stats: { totalRows, parsed, inScope, flagged, byRoleGeo } };
}
