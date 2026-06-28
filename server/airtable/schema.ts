import type { CandidateRecord } from '../types.ts';

// ---------------------------------------------------------------------------
// Field-name constants (single source of truth for the Candidates table)
// ---------------------------------------------------------------------------
export const F = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  role: 'Role',
  geo: 'Geo',
  roleDetail: 'Role Detail',
  inScope: 'In Scope',
  source: 'Source',
  stage: 'Current Stage',
  pipelineRaw: 'Pipeline (raw)',
  status: 'Status',
  disposition: 'Disposition',
  dateApplied: 'Date Applied',
  offerDate: 'Offer Date',
  joinDate: 'Join Date',
  referrer: 'Referrer',
  referralId: 'Referral ID',
  referralStatus: 'Referral Status',
  currentTitle: 'Current Title',
  company: 'Company',
  currentCtc: 'Current CTC',
  expectedCtc: 'Expected CTC',
  noticeDays: 'Notice (days)',
  experience: 'Experience',
  location: 'Location',
  linkedin: 'LinkedIn',
  resumeUrl: 'Resume URL',
  skills: 'Skills',
  feedbackScore: 'Feedback Score',
  feedbackDetails: 'Feedback / Notes',
  usMarketExp: 'US Market Exp',
  sourceFile: 'Source File',
  flag: 'Flag',
  lastUpload: 'Last Upload',
} as const;

type FieldDef = { name: string; type: string; options?: unknown };
const sel = (...choices: string[]): FieldDef['options'] => ({ choices: choices.map((name) => ({ name })) });
const date = { dateFormat: { name: 'iso' } };
const int = { precision: 0 };
const check = { icon: 'check', color: 'greenBright' };

// ---------------------------------------------------------------------------
// Table definitions consumed by setup.ts (Metadata API). First field = primary.
// ---------------------------------------------------------------------------
export const TABLES: { name: string; fields: FieldDef[] }[] = [
  {
    name: 'Candidates',
    fields: [
      { name: F.name, type: 'singleLineText' },
      { name: F.email, type: 'singleLineText' },
      { name: F.phone, type: 'singleLineText' },
      { name: F.role, type: 'singleSelect', options: sel('SDR', 'SDR Manager', 'Other') },
      { name: F.geo, type: 'singleSelect', options: sel('US', 'Europe', 'ROW', 'Unknown') },
      { name: F.roleDetail, type: 'singleLineText' },
      { name: F.inScope, type: 'checkbox', options: check },
      { name: F.source, type: 'singleSelect', options: sel('Referral', 'LinkedIn', 'Job Board', 'Sourced', 'Direct', 'Other') },
      { name: F.stage, type: 'singleSelect', options: sel('Sourced', 'Applied', 'Screening', 'Recruiter Screening', 'CV Review', 'Round 1', 'Round 2', 'Round 3', 'Cultural Round', 'Offer', 'Hired', 'Rejected', 'Withdrawn') },
      { name: F.pipelineRaw, type: 'singleLineText' },
      { name: F.status, type: 'singleSelect', options: sel('Active', 'Offered', 'Hired', 'Joined', 'Rejected', 'Withdrawn', 'Backout') },
      { name: F.disposition, type: 'singleSelect', options: sel('Processing', 'Recruiter Screening', 'Hiring Manager Reject', 'Interview Reject', 'Rejected Not Relevant', 'Duplicate', 'Backout', 'Over Budget', 'Offered', 'Joined') },
      { name: F.dateApplied, type: 'date', options: date },
      { name: F.offerDate, type: 'date', options: date },
      { name: F.joinDate, type: 'date', options: date },
      { name: F.referrer, type: 'singleLineText' },
      { name: F.referralId, type: 'singleLineText' },
      { name: F.referralStatus, type: 'singleLineText' },
      { name: F.currentTitle, type: 'singleLineText' },
      { name: F.company, type: 'singleLineText' },
      { name: F.currentCtc, type: 'number', options: int },
      { name: F.expectedCtc, type: 'number', options: int },
      { name: F.noticeDays, type: 'number', options: int },
      { name: F.experience, type: 'singleLineText' },
      { name: F.location, type: 'singleLineText' },
      { name: F.linkedin, type: 'singleLineText' },
      { name: F.resumeUrl, type: 'singleLineText' },
      { name: F.skills, type: 'multilineText' },
      { name: F.feedbackScore, type: 'singleLineText' },
      { name: F.feedbackDetails, type: 'multilineText' },
      { name: F.usMarketExp, type: 'singleLineText' },
      { name: F.sourceFile, type: 'singleLineText' },
      { name: F.flag, type: 'singleSelect', options: sel('test', 'no_email', 'bad_email') },
      { name: F.lastUpload, type: 'date', options: date },
    ],
  },
  {
    name: 'Upload Batches',
    fields: [
      { name: 'File', type: 'singleLineText' },
      { name: 'Type', type: 'singleSelect', options: sel('ats', 'referral', 'offer') },
      { name: 'Uploaded At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Role', type: 'singleLineText' },
      { name: 'Geo', type: 'singleLineText' },
      { name: 'Total Rows', type: 'number', options: int },
      { name: 'Parsed', type: 'number', options: int },
      { name: 'In Scope', type: 'number', options: int },
      { name: 'Created', type: 'number', options: int },
      { name: 'Updated', type: 'number', options: int },
      { name: 'Flagged', type: 'number', options: int },
    ],
  },
  {
    name: 'Interviewers',
    fields: [
      { name: 'Name', type: 'singleLineText' },
      { name: 'Aliases', type: 'singleLineText' },
      { name: 'Email', type: 'singleLineText' },
      { name: 'Calendar ID', type: 'singleLineText' },
      { name: 'Geo Pool', type: 'singleSelect', options: sel('US', 'Europe', 'Both') },
      { name: 'Active', type: 'checkbox', options: check },
    ],
  },
  {
    name: 'Interviews',
    fields: [
      { name: 'Summary', type: 'singleLineText' }, // candidate · round · interviewer
      { name: 'Candidate Name', type: 'singleLineText' },
      { name: 'Candidate Email', type: 'singleLineText' },
      { name: 'Matched Candidate', type: 'checkbox', options: check },
      { name: 'Interviewer', type: 'singleLineText' },
      { name: 'Interviewer Matched', type: 'checkbox', options: check },
      { name: 'Round', type: 'singleSelect', options: sel('Screening', 'Round 1', 'Round 2', 'Round 3', 'Cultural Round', 'Assessment') },
      { name: 'Role', type: 'singleSelect', options: sel('SDR', 'SDR Manager', 'Other') },
      { name: 'Geo', type: 'singleSelect', options: sel('US', 'Europe', 'ROW', 'Unknown') },
      { name: 'In Scope', type: 'checkbox', options: check },
      { name: 'Interview Date', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Duration (min)', type: 'number', options: int },
      { name: 'Event Status', type: 'singleSelect', options: sel('confirmed', 'tentative', 'cancelled') },
      { name: 'Event Type', type: 'singleLineText' },
      { name: 'Confidence', type: 'singleSelect', options: sel('high', 'medium') },
      { name: 'Matched By', type: 'singleLineText' },
      { name: 'Calendar Source', type: 'singleLineText' },
      { name: 'iCalUID', type: 'singleLineText' }, // cross-calendar dedup key
      { name: 'Rescheduled', type: 'checkbox', options: check },
      { name: 'Needs Review', type: 'checkbox', options: { icon: 'check', color: 'redBright' } },
      { name: 'Review Reason', type: 'singleLineText' },
      { name: 'Raw Title', type: 'singleLineText' },
      { name: 'Fetched At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Calendar Sources', // which calendars to pull, with per-calendar sync cursor
    fields: [
      { name: 'Name', type: 'singleLineText' },
      { name: 'Email', type: 'singleLineText' }, // calendar id
      { name: 'Type', type: 'singleSelect', options: sel('TA Coordinator', 'Interviewer') },
      { name: 'Active', type: 'checkbox', options: check },
      { name: 'Last Synced', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Notes', type: 'singleLineText' },
    ],
  },
];

// TA coordinators own the interview events. Fill their Email in Airtable
// (calendar id = their Leena address) before the first sync.
export const CALENDAR_SOURCE_SEED = [
  { Name: 'Abhilasha', Type: 'TA Coordinator', Active: true },
  { Name: 'Mayanka Trehan', Type: 'TA Coordinator', Active: true },
  { Name: 'Richa Sinha', Type: 'TA Coordinator', Active: true },
];

export const INTERVIEWER_SEED = [
  { Name: 'Nikhil', Aliases: 'Nick,Nikhil', 'Geo Pool': 'US', Active: true },
  { Name: 'Shravan', Aliases: 'Shravan', 'Geo Pool': 'US', Active: true },
  { Name: 'Shubham Gill', Aliases: 'Shubham Gill,Shubham G', 'Geo Pool': 'US', Active: true },
  { Name: 'Shubham Mittal', Aliases: 'Shubham Mittal,Shubham M', 'Geo Pool': 'US', Active: true },
  { Name: 'Sabarinath', Aliases: 'Sabarinath,Sabari', 'Geo Pool': 'US', Active: true },
  { Name: 'Asad', Aliases: 'Asad,Asad Mansuri', 'Geo Pool': 'Both', Active: true },
  { Name: 'Jayeeta', Aliases: 'Jayeeta', 'Geo Pool': 'Both', Active: true },
  { Name: 'Chinar', Aliases: 'Chinar', 'Geo Pool': 'Europe', Active: true },
  { Name: 'Raghav', Aliases: 'Raghav', 'Geo Pool': 'Europe', Active: true },
  { Name: 'Akshay', Aliases: 'Akshay', 'Geo Pool': 'Europe', Active: true },
];

/** Convert a CandidateRecord to an Airtable fields object (omitting empties). */
export function toAirtableFields(rec: CandidateRecord, uploadedAt: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, val: unknown) => {
    if (val !== null && val !== undefined && val !== '') out[key] = val;
  };

  // Offer/join files only touch status + dates on existing candidates.
  if (rec.updateOnly) {
    put(F.name, rec.name);
    put(F.email, rec.email);
    put(F.status, rec.status);
    put(F.offerDate, rec.offerDate);
    put(F.joinDate, rec.joinDate);
    put(F.sourceFile, rec.sourceFile);
    put(F.lastUpload, uploadedAt);
    return out;
  }

  put(F.name, rec.name);
  put(F.email, rec.email);
  put(F.phone, rec.phone);
  put(F.role, rec.role);
  put(F.geo, rec.geo);
  put(F.roleDetail, rec.roleDetail);
  if (rec.inScope !== undefined) out[F.inScope] = rec.inScope;
  put(F.source, rec.source);
  put(F.stage, rec.currentStage);
  put(F.pipelineRaw, rec.pipelineRaw);
  put(F.status, rec.status);
  put(F.disposition, rec.disposition);
  put(F.dateApplied, rec.dateApplied);
  put(F.referrer, rec.referrer);
  put(F.referralId, rec.referralId);
  put(F.referralStatus, rec.referralStatus);
  put(F.currentTitle, rec.currentTitle);
  put(F.company, rec.company);
  put(F.currentCtc, rec.currentCtc);
  put(F.expectedCtc, rec.expectedCtc);
  put(F.noticeDays, rec.noticeDays);
  put(F.experience, rec.experience);
  put(F.location, rec.location);
  put(F.linkedin, rec.linkedin);
  put(F.resumeUrl, rec.resumeUrl);
  put(F.skills, rec.skills);
  put(F.feedbackScore, rec.feedbackScore);
  put(F.feedbackDetails, rec.feedbackDetails);
  put(F.usMarketExp, rec.usMarketExp);
  put(F.sourceFile, rec.sourceFile);
  put(F.flag, rec.flag);
  put(F.lastUpload, uploadedAt);
  return out;
}
