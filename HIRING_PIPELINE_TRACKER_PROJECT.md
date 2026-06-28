# Hiring Pipeline Tracker - Claude Code Project Brief

## What This Is

A self-hosted web app that gives Leena AI's hiring team real-time visibility into their recruiting pipeline by combining two data sources:
1. **ATS CSV exports** from PyJaama HR (the current ATS, which has no API and limited reporting)
2. **Google Calendar events** fetched from interviewer calendars (to capture interview scheduling data the ATS doesn't surface well)

The app processes, deduplicates, and stores this data, then renders it in two views: a filterable tabulated funnel and a visual pipeline view.

---

## Why This Exists

Leena AI evaluated Greenhouse ($30-33K/yr), Ashby, Lever, and Workable as ATS replacements. All were too expensive for the gaps they'd fill. The three core pain points with PyJaama HR are: no pipeline visualization or reporting (HR manually exports to sheets), limited source tracking, and no way to see cross-interviewer interview activity in one place. This tool solves the reporting and visibility gap without replacing the ATS.

---

## Data Sources

### 1. ATS CSV Exports (PyJaama HR)

PyJaama HR supports CSV export of candidate data. The user will manually export and upload CSVs on a roughly weekly cadence. Expected fields (confirm with first real export, but likely):

- Candidate Name
- Email
- Phone
- Role / Position applied for
- Source (Referral, LinkedIn, Job Board, Direct, etc.)
- Current Stage (Applied, Screening, Round 1, Round 2, Offer, Hired, Rejected)
- Date Applied
- Interviewer(s) assigned
- Interview date(s)
- Status / Disposition
- Any notes or tags

**Key constraint:** The same candidate may appear across multiple weekly uploads. The app must deduplicate on a stable identifier. Email is the most reliable dedup key. If email is missing, fall back to (Name + Phone) or (Name + Role).

**Upload behavior:**
- A candidate profile can be open for 10+ days
- User uploads data roughly weekly, so one candidate could appear in 2-3 consecutive uploads
- On re-upload, the app should update existing records (not create duplicates) and preserve history of stage transitions
- The app should show a summary after each upload: X new candidates, Y updated, Z unchanged

### 2. Google Calendar Events (Interviewer Calendars)

The app fetches interview events from selected interviewer Google Calendars using the Google Calendar API. This captures scheduling data that PyJaama HR handles poorly.

**Interviewers to track (two geo pools, some overlap):**

US Pool:
- Nikhil (goes by "Nick")
- Shravan
- Shubham Gill
- Shubham Mittal
- Sabarinath
- Asad
- Jayeeta (Cultural Round only)

Europe Pool:
- Chinar
- Raghav
- Akshay
- Asad
- Jayeeta (Cultural Round only)

Note: Asad and Jayeeta appear in both pools. The app should tag interviewers with their pool(s) and allow filtering by geo.

**Calendar fetch logic:**
- Auth against Asad's Google Workspace account as the base, then query calendars for each configured interviewer
- Time range: configurable, default last 30 days
- Deduplicate across calendars: the same interview appears on both the interviewer's and the scheduling coordinator's calendar. Dedup on (candidate name/email + date + time window) or (event ID if shared calendar events)
- Store fetched events with a timestamp so subsequent fetches only pull new/modified events (incremental sync using `updatedMin` parameter)

**Calendar event title format (standard structure, needs normalization):**
```
R2 | SDR - US | Amit Tripathy <> Asad Mansuri | Leena.ai
```

Parsing rules for event titles:
- Split on ` | ` (pipe with spaces) into segments
- Segment 1: Round identifier. Normalize variations: "R1" -> "Round 1", "R2" -> "Round 2", "Cultural" or "CR" -> "Cultural Round". May also see "Screening", "Assessment", etc.
- Segment 2: Role + Geo. Parse as "{Role} - {Geo}". Expected values: "SDR - US", "SDR - Europe". Filter to only these two for now; ignore other roles.
- Segment 3: Candidate <> Interviewer. Split on ` <> ` to get candidate name (left) and interviewer name (right). Handle edge cases: names with multiple words, possible ordering inconsistency (interviewer might be on the left sometimes).
- Segment 4: Company tag ("Leena.ai"). Can be ignored for data purposes but useful as a filter to confirm this is an interview event.

**Normalization needed:**
- Some events may not follow this exact format (e.g., manually created events, rescheduled events with "[Rescheduled]" prefix, cancelled events)
- Events that don't match the expected pattern should be flagged for manual review rather than silently dropped
- Candidate names need normalization: trim whitespace, title case, handle "Firstname Lastname" vs "Lastname, Firstname"
- Interviewer names need matching to the configured interviewer list (fuzzy match on first name since calendar names may vary: "Nick" vs "Nikhil", "Shubham G" vs "Shubham Gill")

**Extract from each event:**
- Round (parsed from segment 1)
- Role (parsed from segment 2, e.g., "SDR")
- Geo (parsed from segment 2, e.g., "US" or "Europe")
- Candidate name (parsed from segment 3)
- Interviewer name (parsed from segment 3, matched to config)
- Interview date/time (from event start)
- Duration (from event start/end)
- Attendee emails (from event attendees list, useful for candidate email capture)
- Event status (confirmed, tentative, cancelled)

**Auth approach:** Use Google OAuth 2.0 with Calendar API read scope. Store refresh tokens securely. The app only needs read access to calendars.

---

## Data Model

### Candidates Table
```
id                  UUID (primary key)
name                TEXT
email               TEXT (unique, primary dedup key)
phone               TEXT
role                TEXT (the position they applied for, e.g., "SDR")
geo                 TEXT (US, Europe - parsed from calendar events or ATS data)
source              TEXT (Referral, LinkedIn, Job Board, Direct, etc.)
current_stage       TEXT (latest stage from ATS data)
date_applied        DATE
status              TEXT (Active, Hired, Rejected, Withdrawn)
created_at          TIMESTAMP
updated_at          TIMESTAMP
```

### Stage History Table
```
id                  UUID
candidate_id        FK -> candidates
stage               TEXT
entered_at          TIMESTAMP (when they moved to this stage)
source_type         TEXT ('ats_upload' or 'calendar_event')
source_ref          TEXT (upload batch ID or calendar event ID)
```

### Interviews Table
```
id                  UUID
candidate_id        FK -> candidates (nullable if unmatched)
interviewer_name    TEXT
interviewer_email   TEXT
interview_date      DATETIME
duration_minutes    INTEGER
round               TEXT (Round 1, Round 2, Cultural Round, etc.)
role                TEXT (parsed from calendar title, e.g., "SDR")
geo                 TEXT (parsed from calendar title, e.g., "US", "Europe")
calendar_event_id   TEXT (Google Calendar event ID for dedup)
calendar_source     TEXT (which interviewer's calendar this came from)
event_status        TEXT (confirmed, tentative, cancelled)
raw_title           TEXT (original unparsed event title for debugging)
fetched_at          TIMESTAMP
```

### Upload Batches Table
```
id                  UUID
filename            TEXT
uploaded_at         TIMESTAMP
records_total       INTEGER
records_new         INTEGER
records_updated     INTEGER
records_unchanged   INTEGER
```

### Interviewers Config Table
```
id                  UUID
name                TEXT (display name)
aliases             TEXT (comma-separated alternate names, e.g., "Nick,Nikhil" for fuzzy matching)
email               TEXT
calendar_id         TEXT (Google Calendar ID, typically the email address)
geo_pool            TEXT (US, Europe, or Both)
is_active           BOOLEAN
```

**Seed data for interviewers:**
| Name | Aliases | Geo Pool |
|------|---------|----------|
| Nikhil | Nick, Nikhil | US |
| Shravan | Shravan | US |
| Shubham Gill | Shubham Gill, Shubham G | US |
| Shubham Mittal | Shubham Mittal, Shubham M | US |
| Sabarinath | Sabarinath, Sabari | US |
| Asad | Asad, Asad Mansuri | Both |
| Jayeeta | Jayeeta | Both |
| Chinar | Chinar | Europe |
| Raghav | Raghav | Europe |
| Akshay | Akshay | Europe |

---

## Tech Stack (Recommended)

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js (Express or Fastify)
- **Database:** SQLite (via better-sqlite3) for simplicity, single-file DB, no server needed. Upgrade to PostgreSQL later if needed.
- **Calendar Integration:** Google Calendar API v3 via googleapis npm package
- **CSV Parsing:** papaparse
- **Charts:** Recharts (for funnel/visual views)
- **Auth:** Google OAuth 2.0 (for calendar access only; the app itself can be unauthed or simple password-protected since it's internal)

This runs locally or on a single server. No need for cloud infra initially.

---

## UI Specification

### Global Filters (persistent across both views)
- **Geo filter:** Toggle or dropdown: US, Europe, All (this is the primary segmentation)
- **Role filter:** Dropdown of all distinct roles. For now, only "SDR - US" and "SDR - Europe" are in scope. The filter exists so the app can expand to other roles later without redesign.
- **Source filter:** Dropdown/multi-select (Referral, LinkedIn, Job Board, Direct, etc.)
- **Round filter:** Dropdown/multi-select (Round 1, Round 2, Cultural Round, etc.)
- **Interviewer filter:** Dropdown/multi-select from interviewers config (auto-filtered by selected Geo when a Geo is active)
- **Date range:** Start and end date picker
- **Status filter:** Active, Hired, Rejected, Withdrawn

### View 1: Tabulated Funnel View

A table showing the pipeline as a funnel with drill-down capability.

**Top-level funnel summary row:**
| Stage | Count | Conversion % | Avg Days in Stage |
|-------|-------|-------------|------------------|
| Applied | 142 | -- | 2.1 |
| Screening | 98 | 69% | 3.4 |
| Round 1 | 67 | 68% | 4.2 |
| Round 2 | 34 | 51% | 3.8 |
| Offer | 12 | 35% | 2.0 |
| Hired | 8 | 67% | -- |
| Rejected | 54 | -- | -- |

**Below the funnel:** A detailed table of individual candidates, sortable and filterable by all columns:
- Candidate Name
- Geo (US / Europe)
- Role
- Source
- Current Stage
- Interviewer(s) (comma-separated)
- Date Applied
- Days in Pipeline
- Last Activity Date
- Status

Clicking a candidate row expands to show their full stage history timeline and interview details.

### View 2: Visual Pipeline View

A Kanban-style or Sankey-style visualization showing:
- Candidates as cards flowing through stages
- Color-coded by source
- Card shows: Name, Geo badge (US/EU), Role, Days in stage, Interviewer
- Drag is NOT needed (this is read-only visualization, not a management tool)
- Stage columns with counts and conversion arrows between them
- Option to toggle between Kanban layout and Sankey flow diagram

### View 3: Upload & Sync Management (Settings/Admin)

- **CSV Upload:** Drag-and-drop zone, shows preview of first 5 rows, column mapping UI (map CSV columns to expected fields), upload button with progress, post-upload summary (new/updated/unchanged)
- **Calendar Sync:** List of configured interviewers with toggle on/off, "Sync Now" button per interviewer or "Sync All", last sync timestamp per interviewer, sync log showing events found/matched/new
- **Interviewer Management:** Add/remove interviewers, configure their calendar IDs

---

## Deduplication Logic

### CSV Upload Dedup
1. Parse incoming CSV
2. For each row, normalize email to lowercase
3. Look up candidate by email in DB
4. If found: compare fields, update any that changed, log stage transition if stage changed, increment "updated" counter
5. If not found: create new candidate record, log initial stage, increment "new" counter
6. If email is empty: attempt match on (normalized_name + phone) or (normalized_name + role)
7. Log the upload batch with stats

### Calendar Event Dedup
1. Fetch events from Google Calendar API with `updatedMin` = last sync timestamp
2. For each event, check if `calendar_event_id` already exists in interviews table
3. If exists: update if modified (check event updated timestamp)
4. If new: attempt to match to a candidate by parsing candidate name/email from event title/description/attendees
5. Unmatched events are stored with null candidate_id and flagged for manual review
6. Cross-calendar dedup: if the same event appears on two interviewers' calendars (same event ID or same candidate + same time), store once and tag both interviewers

---

## Weekly Refresh Workflow

The intended usage pattern:
1. **Monday:** User exports CSV from PyJaama HR, uploads to the app
2. **Monday:** User clicks "Sync All Calendars" to pull latest interview events
3. **During the week:** Team uses the funnel and visual views to track pipeline health
4. **Next Monday:** Repeat. The app handles incremental updates gracefully.

---

## Key Business Context

- **Company:** Leena AI (agentic AI for enterprise HR/IT/Finance)
- **Location:** Bangalore, India
- **Roles in scope:** SDR - US and SDR - Europe only. Other roles exist in the pipeline but are out of scope for this tool initially.
- **Interview structure:** Multi-round pipeline. R1 (initial screen), R2 (deeper evaluation), Cultural Round (Jayeeta). Calendar events use "R1", "R2", "Cultural" labels.
- **Two Shubhams:** Shubham Gill and Shubham Mittal are both interviewers in the US pool. The parser must distinguish them (likely by last name in calendar events, or by email in attendee lists).
- **Nikhil/Nick:** Goes by "Nick" informally but calendar events may use either name. Fuzzy matching via aliases is required.
- **Hiring stakeholders:** Shubham Gill (SDR hiring lead), Richa (talent/sourcing), Asad (EIR, Round 2 interviewer for both geos)
- **Pain point being solved:** HR currently spends hours manually exporting data into sheets for visibility. Interviewers have no unified view of where candidates are. No conversion metrics exist.
- **This is an internal tool** - does not need to be production-grade or publicly accessible. Clean, functional, and fast is the bar.

---

## Implementation Phases

### Phase 1: Core Data Layer + CSV Upload
- Set up project structure (React + Vite + Express + SQLite)
- Build data model / migrations
- CSV upload with column mapping, dedup, and batch logging
- Basic candidate list view with filters

### Phase 2: Funnel View + Filters
- Funnel summary calculations (counts, conversion %, avg days)
- Detailed candidate table with sort/filter
- Candidate detail expansion (stage history)
- Global filter bar (role, source, round, interviewer, date range)

### Phase 3: Calendar Integration
- Google OAuth flow for calendar access (auth via Asad's workspace account)
- Interviewer configuration UI with alias support and geo pool tagging
- Calendar event fetching with title parsing: `R2 | SDR - US | Candidate <> Interviewer | Leena.ai`
- Fuzzy matching of interviewer names to config (handle Nick/Nikhil, Shubham G/Shubham Gill)
- Event-to-candidate matching (by name from parsed title, cross-referenced with ATS candidates)
- Incremental sync with timestamp tracking
- Unmatched events flagged for manual review

### Phase 4: Visual Pipeline View
- Kanban-style stage columns with candidate cards
- Color coding by source
- Conversion arrows between stages
- Toggle to Sankey flow diagram (stretch)

### Phase 5: Polish
- Upload history view
- Sync logs
- Export to CSV/PDF
- Error handling and edge cases

---

## File Structure (Suggested)

```
hiring-pipeline-tracker/
├── README.md
├── package.json
├── .env.example          # Google OAuth creds, DB path
├── prisma/               # or migrations/ if using raw SQL
│   └── schema.prisma
├── server/
│   ├── index.ts          # Express server entry
│   ├── routes/
│   │   ├── candidates.ts
│   │   ├── uploads.ts
│   │   ├── calendar.ts
│   │   └── interviewers.ts
│   ├── services/
│   │   ├── csvProcessor.ts
│   │   ├── calendarSync.ts
│   │   ├── dedup.ts
│   │   └── metrics.ts
│   └── db/
│       ├── sqlite.ts
│       └── migrations/
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── FilterBar.tsx
│   │   │   ├── FunnelView.tsx
│   │   │   ├── VisualPipeline.tsx
│   │   │   ├── CandidateTable.tsx
│   │   │   ├── CandidateDetail.tsx
│   │   │   ├── UploadZone.tsx
│   │   │   ├── CalendarSync.tsx
│   │   │   └── InterviewerConfig.tsx
│   │   ├── hooks/
│   │   ├── utils/
│   │   └── types/
│   └── index.html
└── data/
    └── pipeline.db       # SQLite database file
```

---

## Environment Variables

```env
# Google OAuth (for Calendar API)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Database
DATABASE_PATH=./data/pipeline.db

# Server
PORT=3000
```

---

## Non-Goals (Explicitly Out of Scope)

- This is NOT a replacement for PyJaama HR. Candidates are still managed there. This is a read-only reporting layer.
- No candidate communication features (no emails, no scheduling)
- No feedback/scorecard collection (use Notion or Google Docs for that)
- No multi-tenant / team permissions. Single-user internal tool.
- No mobile optimization initially (desktop-first)

---

## Open Questions for First Session

### Answered
- ~~Google Workspace account~~ -> Auth via Asad's account, query interviewer calendars from there
- ~~Calendar event format~~ -> `R2 | SDR - US | Candidate <> Interviewer | Leena.ai` (needs normalization)
- ~~Role scope~~ -> SDR - US and SDR - Europe only
- ~~Interviewer list~~ -> 10 interviewers across US and Europe pools (see Interviewers Config seed data above)

### Still Open (resolve in first coding session)
1. **PyJaama HR CSV columns:** User will upload a sample export. Build the column mapper against actual data, not assumptions. Check if there's a unique candidate ID field.
2. **Calendar ID discovery:** Need the actual email addresses / calendar IDs for each of the 10 interviewers. Asad can look these up in Google Workspace admin or simply use the interviewer email addresses as calendar IDs (the default in Google).
3. **Edge cases in calendar title format:** How often do events deviate from the standard `R1 | SDR - US | Name <> Name | Leena.ai` pattern? Are there rescheduled events with a different prefix? What about cancelled interviews - are they deleted or marked differently?
4. **Candidate name matching between ATS and Calendar:** If the ATS CSV has "Amit Kumar Tripathy" and the calendar has "Amit Tripathy", the fuzzy matching threshold needs tuning. Start with Levenshtein distance and iterate.
5. **Stage definitions across ATS and Calendar:** Map the exact stage names used in PyJaama HR to the normalized stages in this app (Applied, Screening, Round 1, Round 2, Cultural Round, Offer, Hired, Rejected, Withdrawn).
