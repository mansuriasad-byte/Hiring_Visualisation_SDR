// Lightweight fuzzy name matching for reconciling calendar interviews to
// referral candidates. No external dependencies.

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = cur;
    }
  }
  return dp[n];
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

export interface FuzzyResult {
  name: string;
  score: number; // 0–1, higher = better
  method: 'exact' | 'first-last' | 'token-overlap' | 'fuzzy-tokens';
}

export function fuzzyNameMatch(
  query: string,
  candidates: string[],
  threshold = 0.6,
): FuzzyResult | null {
  const qTokens = tokenize(query);
  if (!qTokens.length) return null;

  let best: FuzzyResult | null = null;

  for (const name of candidates) {
    const cTokens = tokenize(name);
    if (!cTokens.length) continue;

    // 1. Exact token match (order-independent)
    if (qTokens.length === cTokens.length && qTokens.every((t) => cTokens.includes(t))) {
      return { name, score: 1, method: 'exact' };
    }

    // 2. First + last name match (handles middle names)
    const qFirst = qTokens[0], qLast = qTokens[qTokens.length - 1];
    const cFirst = cTokens[0], cLast = cTokens[cTokens.length - 1];
    if (qFirst === cFirst && qLast === cLast && qTokens.length >= 2 && cTokens.length >= 2) {
      const score = 0.95;
      if (!best || score > best.score) best = { name, score, method: 'first-last' };
      continue;
    }

    // 3. Token overlap ratio (Jaccard-ish)
    const overlap = qTokens.filter((t) => cTokens.includes(t)).length;
    const unionSize = new Set([...qTokens, ...cTokens]).size;
    const overlapScore = overlap / unionSize;
    if (overlapScore >= threshold && (!best || overlapScore > best.score)) {
      best = { name, score: overlapScore, method: 'token-overlap' };
      continue;
    }

    // 4. Fuzzy token match: each query token must match some candidate token
    //    with edit distance ≤ 2 (for tokens ≥ 4 chars) or ≤ 1 (shorter)
    if (qTokens.length >= 2 && cTokens.length >= 2) {
      let fuzzyMatched = 0;
      for (const qt of qTokens) {
        const maxDist = qt.length >= 4 ? 2 : 1;
        if (cTokens.some((ct) => levenshtein(qt, ct) <= maxDist)) fuzzyMatched++;
      }
      const fuzzyScore = fuzzyMatched / Math.max(qTokens.length, cTokens.length);
      if (fuzzyScore >= threshold && (!best || fuzzyScore > best.score)) {
        best = { name, score: fuzzyScore, method: 'fuzzy-tokens' };
      }
    }
  }

  return best;
}
