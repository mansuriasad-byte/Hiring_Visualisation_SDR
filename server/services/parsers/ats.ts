import type { CandidateRecord, ParseResult } from '../../types.ts';
import { parseCsv, firstNonEmpty, buildResult } from '../csv.ts';
import {
  normalizeName, normalizeEmail, normalizePhone, normalizeSource,
  parseRoleTitle, parseFlexibleDate, parseNumber, mapAtsPipeline, classifyRow,
} from '../normalize.ts';

export interface AtsOptions {
  role: string; // fallback role chosen on upload, e.g. "SDR"
  geo: string; // fallback geo chosen on upload, e.g. "US" | "Europe"
  fileName?: string;
}

/**
 * PyJaama "All ATS Candidates" export. Unlike the older per-role dumps, this
 * file carries role+geo in-file (the `Pipeline?` column: "SDR - US" / "SDM -
 * US"), so we read scope from the row and fall back to the upload selection
 * only when that column is blank.
 *
 * Real columns: name, resume_match, labels, pipeline, experience, source,
 * feedback_score, feedback_details, application_date (M/D/YYYY), recruiter,
 * designation, company, current_ctc, expected_ctc, notice, location, phone,
 * gender, email, degrees, colleges, resume, skills, linkedin, github_url,
 * portfolio_link, social_media, other_links, Cleaned Source, Week, Pipeline?,
 * Referral?
 *
 * SDM rows are tagged out of scope (inScope=false) but NOT dropped. Trailing
 * all-blank/junk rows ("1 1", "0 0") are flagged and skipped downstream.
 */
export function parseAtsExport(content: string, opts: AtsOptions): ParseResult {
  const { rows } = parseCsv(content);

  const records: CandidateRecord[] = rows.map((row) => {
    const name = normalizeName(row['name']);
    const email = normalizeEmail(row['email']);

    // Role/geo: prefer the in-file Pipeline? tag, fall back to upload choice.
    const pipelineTag = (row['Pipeline?'] ?? '').trim();
    const roleInfo = pipelineTag
      ? parseRoleTitle(pipelineTag)
      : parseRoleTitle(`${opts.role} ${opts.geo}`);

    // Furthest stage + outcome, split out of the conflated `pipeline` value.
    const pipelineRaw = (row['pipeline'] ?? '').trim() || null;
    const mapped = mapAtsPipeline(pipelineRaw);

    return {
      name,
      email,
      phone: normalizePhone(row['phone']),
      role: roleInfo.role,
      geo: roleInfo.geo,
      roleDetail: roleInfo.roleDetail,
      inScope: roleInfo.inScope,
      // "Cleaned Source" is the curated channel; fall back to the raw `source`.
      source: normalizeSource(firstNonEmpty(row, 'Cleaned Source', 'source')),
      currentStage: mapped?.stage ?? 'Applied',
      pipelineRaw,
      status: mapped?.status ?? 'Active',
      dateApplied: parseFlexibleDate(row['application_date']),
      currentTitle: row['designation']?.trim() || null,
      company: row['company']?.trim() || null,
      currentCtc: parseNumber(row['current_ctc']),
      expectedCtc: parseNumber(row['expected_ctc']),
      noticeDays: parseNumber(row['notice']),
      experience: row['experience']?.trim() || null,
      location: row['location']?.trim() || null,
      linkedin: row['linkedin']?.trim() || null,
      resumeUrl: row['resume']?.trim() || null,
      skills: row['skills']?.trim() || null,
      feedbackScore: row['feedback_score'] && row['feedback_score'].trim() !== '-' ? row['feedback_score'].trim() : null,
      feedbackDetails: row['feedback_details'] && row['feedback_details'].trim() !== '-' ? row['feedback_details'].trim() : null,
      usMarketExp: row['How much exp do you have in US market?']?.trim() || null,
      sourceFile: opts.fileName ?? null,
      flag: classifyRow(name, email),
    };
  });

  return buildResult('ats', rows.length, records);
}
