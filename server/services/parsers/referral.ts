import type { CandidateRecord, ParseResult } from '../../types.ts';
import { parseCsv, firstNonEmpty, buildResult } from '../csv.ts';
import {
  normalizeName, normalizeEmail, maybeSwapNameEmail, parseRoleTitle,
  parseFlexibleDate, normalizeDisposition, statusFromDisposition, classifyRow,
} from '../normalize.ts';

// Exact header strings from the Employee Referral export. The role and the
// candidate name/email appear in one of two column groups depending on the
// row's age, so we coalesce across both.
const H = {
  itemId: 'Item ID',
  initiatedBy: 'Initiated by',
  initiatedOn: 'Initiated on',
  status: 'Status',
  jobTitleA: 'Job Title (jobTitle) (Employee referral) (label) (select)',
  jobTitleB: 'Job Title (job) (Employee referral) (label) (select)',
  jobTitleC: 'Job Dropdown (job) (Duplicate of Employee referral) (label) (select)',
  nameA: 'Candidate Name (candidateName) (Employee referral) (input)',
  nameB: 'Candidate Name (candidateName) (Duplicate of Employee referral) (input)',
  emailA: 'Candidate Email (candidateEmail) (Employee referral) (input)',
  emailB: 'Candidate Email (candidateEmail) (Duplicate of Employee referral) (input)',
  commentsA: 'Comments (comments) (Employee referral) (input)',
  commentsB: 'Comments (comments) (Duplicate of Employee referral) (input)',
  taRespA: 'TA Response (response) (Employee referral) (label) (select)',
  taRespB: 'TA Response (response) (Duplicate of Employee referral) (label) (select)',
  uploadA: 'Upload Attachment/s (uploadattachment) (Employee referral) (upload)',
  uploadB: 'Upload Attachment/s (uploadattachment) (Duplicate of Employee referral) (upload)',
};

/**
 * Employee Referral dump — all roles mixed. Each row is a referral, not a
 * clean candidate. We tag scope (SDR US/Europe in-scope), capture the referrer
 * and TA disposition, fix swapped name/email columns, and flag test/junk rows.
 */
export function parseReferralDump(content: string, fileName?: string): ParseResult {
  const { rows } = parseCsv(content);

  const records: CandidateRecord[] = rows.map((row) => {
    const nameRaw = firstNonEmpty(row, H.nameA, H.nameB);
    const emailRaw = firstNonEmpty(row, H.emailA, H.emailB);
    const swapped = maybeSwapNameEmail(nameRaw, emailRaw);
    const name = normalizeName(swapped.name);
    const email = normalizeEmail(swapped.email);

    const roleText = firstNonEmpty(row, H.jobTitleA, H.jobTitleB, H.jobTitleC);
    const { role, geo, roleDetail, inScope } = parseRoleTitle(roleText);

    const disposition = normalizeDisposition(firstNonEmpty(row, H.taRespA, H.taRespB));

    return {
      name,
      email,
      role,
      geo,
      roleDetail,
      inScope,
      source: 'Referral',
      disposition,
      status: statusFromDisposition(disposition),
      dateApplied: parseFlexibleDate(row[H.initiatedOn]),
      referrer: row[H.initiatedBy]?.trim() || null,
      referralId: row[H.itemId]?.trim() || null,
      referralStatus: row[H.status]?.trim() || null,
      feedbackDetails: firstNonEmpty(row, H.commentsA, H.commentsB) || null,
      resumeUrl: firstNonEmpty(row, H.uploadA, H.uploadB) || null,
      sourceFile: fileName ?? null,
      flag: classifyRow(name, email),
    };
  });

  return buildResult('referral', rows.length, records);
}
