// Configurable source grouping — maps raw Airtable Source values to display
// groups at query time. Raw data in Airtable is preserved; grouping only
// affects how sources appear in the dashboard, pivot tables, and funnels.
//
// Config persists to server/data/source-groups.json so it survives restarts.
// Admins can update via PUT /api/data/source-groups.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const CONFIG_PATH = join(DATA_DIR, 'source-groups.json');

export interface SourceGroupConfig {
  groups: Record<string, string[]>; // displayName -> rawValues[]
}

const DEFAULT_CONFIG: SourceGroupConfig = {
  groups: {
    'Referral': ['Referral'],
    'LinkedIn': ['LinkedIn', 'Job Board', 'Direct'],
    'Sourced': ['Sourced'],
    'School of SDR': ['SCHOOL OF SDR', 'School of SDR'],
    'Other': ['Other'],
  },
};

function loadFromDisk(): SourceGroupConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.groups && typeof parsed.groups === 'object') return parsed;
  } catch { /* file missing or corrupt — use default */ }
  return structuredClone(DEFAULT_CONFIG);
}

function saveToDisk(cfg: SourceGroupConfig): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.warn('[sourceGroups] Failed to persist config:', err);
  }
}

let current: SourceGroupConfig = loadFromDisk();
let reverseMap: Map<string, string> = buildReverseMap(current);

function buildReverseMap(cfg: SourceGroupConfig): Map<string, string> {
  const m = new Map<string, string>();
  for (const [group, raws] of Object.entries(cfg.groups)) {
    for (const raw of raws) m.set(raw, group);
  }
  return m;
}

export function groupSource(raw: string): string {
  return reverseMap.get(raw) ?? raw;
}

export function getSourceGroupConfig(): SourceGroupConfig {
  return structuredClone(current);
}

export function setSourceGroupConfig(cfg: SourceGroupConfig): void {
  current = structuredClone(cfg);
  reverseMap = buildReverseMap(current);
  saveToDisk(current);
}

export function resetSourceGroupConfig(): void {
  current = structuredClone(DEFAULT_CONFIG);
  reverseMap = buildReverseMap(current);
  saveToDisk(current);
}
