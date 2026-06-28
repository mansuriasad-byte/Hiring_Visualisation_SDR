// Canonical record produced by every parser. Maps 1:1 to the Airtable
// "Candidates" table. Fields are optional because each file type fills a
// different subset (ATS = full profile, referral = referral context,
// offer = status only).
export interface CandidateRecord {
  name: string;
  email: string | null;
  phone?: string | null;

  role?: string | null; // SDR | SDR Manager | Other
  geo?: string | null; // US | Europe | ROW | Unknown
  roleDetail?: string | null; // raw/normalized job title (e.g. "QA Engineer")
  inScope?: boolean;

  source?: string | null; // Referral | LinkedIn | Job Board | Direct | Other
  currentStage?: string | null; // Applied | Screening | Round 1 | ...
  pipelineRaw?: string | null; // verbatim ATS pipeline value (e.g. "R1 Reject")
  status?: string | null; // Active | Offered | Hired | Joined | Rejected | Withdrawn | Backout
  disposition?: string | null; // referral TA Response (Recruiter Screening, Interview Reject, ...)

  dateApplied?: string | null; // ISO date
  offerDate?: string | null;
  joinDate?: string | null;

  // referral context
  referrer?: string | null;
  referralId?: string | null;
  referralStatus?: string | null;

  // ATS enrichment
  currentTitle?: string | null;
  company?: string | null;
  currentCtc?: number | null;
  expectedCtc?: number | null;
  noticeDays?: number | null;
  experience?: string | null;
  location?: string | null;
  linkedin?: string | null;
  resumeUrl?: string | null;
  skills?: string | null;
  feedbackScore?: string | null;
  feedbackDetails?: string | null;
  usMarketExp?: string | null;

  // provenance / quality
  sourceFile?: string | null;
  flag?: 'test' | 'no_email' | 'bad_email' | null;
  updateOnly?: boolean; // offer/join files only update existing candidates
}

export type UploadType = 'ats' | 'referral' | 'offer';

export interface ParseResult {
  type: UploadType;
  records: CandidateRecord[];
  stats: {
    totalRows: number;
    parsed: number; // usable records (flag === null)
    inScope: number;
    flagged: { test: number; no_email: number; bad_email: number };
    byRoleGeo: Record<string, number>;
  };
}
