// Configurable source grouping — maps raw Airtable Source values to display
// groups at query time. Raw data in Airtable is preserved; grouping only
// affects how sources appear in the dashboard, pivot tables, and funnels.
//
// Default: each canonical source maps to itself (no merging).
// Admins can update via PUT /api/data/source-groups.

export interface SourceGroupConfig {
  groups: Record<string, string[]>; // displayName -> rawValues[]
}

const DEFAULT_CONFIG: SourceGroupConfig = {
  groups: {
    'Referral': ['Referral'],
    'LinkedIn': ['LinkedIn'],
    'Job Board': ['Job Board'],
    'Sourced': ['Sourced'],
    'Direct': ['Direct'],
    'Other': ['Other'],
  },
};

let current: SourceGroupConfig = structuredClone(DEFAULT_CONFIG);
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
}

export function resetSourceGroupConfig(): void {
  current = structuredClone(DEFAULT_CONFIG);
  reverseMap = buildReverseMap(current);
}
