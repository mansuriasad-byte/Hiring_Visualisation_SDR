# Hiring Pipeline Tracker

Self-hosted reporting layer over Leena AI's recruiting pipeline. A small Node
ingestion service parses PyJaama HR CSV exports, normalizes and deduplicates
them, and writes to **Airtable**, which serves as both the database and the
visual layer (grid, Kanban pipeline, dashboards).

See [HIRING_PIPELINE_TRACKER_PROJECT.md](HIRING_PIPELINE_TRACKER_PROJECT.md) for the full brief.

## Architecture

```
CSV upload ──► Node ingestion service ──► Airtable
 (3 types)      parse → normalize →         (storage + Kanban/grid/
                dedup/scope-tag             dashboard views)
```

Airtable was chosen over Notion: it handles 10K rows comfortably, has a native
**upsert API** (merge on email = our dedup key), and Kanban/Interface views
cover the funnel and pipeline screens without a custom frontend.

## The three upload types

The upload picks a **type**, which selects a parser and a write behavior:

| Type | File | Behavior |
|------|------|----------|
| `ats` | PyJaama per-role candidate export | Upsert candidates. **Requires `role` + `geo` on upload** — the export has no role column (the export *is* the role). |
| `referral` | Employee Referral dump (all roles) | Parse `Job Title` → normalize role/geo, **store all, tag `In Scope`** (SDR US/Europe). Captures referrer + TA disposition. Filters test/junk rows. |
| `offer` | Offer & join status | **Update-only**: matches existing candidates by email and patches status/offer/join dates. Never creates. Unmatched rows are reported. |

Dedup is email-based via Airtable upsert (`fieldsToMergeOn: ['Email']`).
Normalization handles: lowercased email, title-cased names, `"Last, First"`
flips, swapped name/email columns (real referral rows have this), digit-only
phones, flexible dates (`"10 Jun, 2026"` and `"Jun 10, 2026 01:39 PM"`), ATS
stage labels, and role/geo variants (`"SDR - US"`, `"...Europe"`,
`"...North America"`, `"Sales Development Manager"`, `"SDR- ROW"`, …).
Test/junk rows (internal `leena.ai` emails, symbol-only names, `test`/`lol`
tokens, malformed emails) are flagged and skipped from writes.

## Setup

```bash
npm install
cp .env.example .env          # add AIRTABLE_PAT + AIRTABLE_BASE_ID

# 1. Create an empty base in Airtable, put its app... id in .env
# 2. Build the tables/fields + seed interviewers:
npm run setup:airtable

npm run dev                   # start API (or: npm start)
```

The PAT needs scopes: `data.records:read/write`, `schema.bases:read/write`.
**Without a token the app still runs** — uploads return a dry-run summary
(parse + scope + flag counts) so the pipeline is fully testable first.

## API

### Calendar sync (Google → Interviews table)

- `GET /auth/google` — one-time OAuth consent (open in a browser as Asad).
- `GET /api/calendar/status` — readiness + configured calendar sources.
- `POST /api/calendar/sync` — pull interview events into the Interviews table.
  Body (all optional): `{ since: "2026-04-01", windowDays, forwardDays, dryRun }`.
  Without `since` it does an incremental pull (per-calendar `updatedMin` cursor).

Sources are the **TA coordinators'** calendars (Calendar Sources table) — they
own the interview events; the interviewer is parsed from the event title.
Events are deduped across calendars on `iCalUID`. An event is treated as an
interview by these rules (high/medium confidence; stored either way, tagged):
exclude `focusTime`/`fromGmail` and "Placeholder" titles; HIGH = pipe-delimited
title (`round | role - geo | candidate <> interviewer | Leena.ai`) or
TA-coordinator organizer + exactly one external attendee; MEDIUM = 2+ interview
phrases in the description or a CV/resume attachment.

### Core

- `GET /api/health` — liveness + whether Airtable / Google are configured.
- `POST /api/uploads/preview` — form-data `file`, `type` (+ `role`,`geo` for ats). Parses without writing; returns headers, first rows, and parse stats.
- `POST /api/uploads` — same fields; parses + dedups into Airtable. Returns `{ dryRun, stats, write: { created, updated, skippedFlagged, unmatched? } }`.

## Verify locally (no Airtable needed)

```bash
npm run test:parsers          # runs all 3 parsers against fixtures/, prints stats
npm start &
curl -F "file=@fixtures/ats_sdr_na.csv" -F "type=ats" -F "role=SDR" -F "geo=US" http://localhost:3000/api/uploads
curl -F "file=@fixtures/referrals.csv"  -F "type=referral"                       http://localhost:3000/api/uploads
curl -F "file=@fixtures/offers.csv"     -F "type=offer"                          http://localhost:3000/api/uploads
```

`fixtures/` holds representative rows from the real PyJaama exports (including
the messy edge cases: swapped name/email, role in alternate columns, junk rows).

## Layout

```
server/
  index.ts                  Express entry
  types.ts                  CandidateRecord + ParseResult
  services/
    normalize.ts            email/name/phone/date/role-scope/junk helpers
    csv.ts                  CSV parse + result aggregation
    parsers/
      ats.ts                PyJaama per-role export
      referral.ts           all-roles referral dump (scope tagging)
      offer.ts              offer/join status (update-only)
    ingest.ts               parser → Airtable, with dry-run fallback
  airtable/
    schema.ts               table/field definitions + record mapping + seed
    client.ts               REST client (upsert / update-by-id / lookup)
    setup.ts                creates tables/fields + seeds interviewers
  routes/uploads.ts         type-routed preview + upload
fixtures/                   sample CSVs from the real exports
scripts/testParsers.ts      parser verification harness
```

## Status & next

- **Done:** Airtable schema + setup; 3-type CSV ingestion with dedup/scope-tagging + type-routed upload API; Google Calendar sync (OAuth, 7-rule interview classifier, title parsing, fuzzy interviewer matching, cross-calendar dedup, incremental cursor) — backfilled live from 2026-04-01.
- **Next:** load real ATS/referral exports (boosts interview→candidate matching on re-sync); Airtable Interface dashboards (funnel + Kanban).
- **Tuning backlog:** (1) replace the rule-5 interview-phrase list with the exact set from the prior exercise; (2) disambiguate the two Shubhams via attendee emails (interviewer emails are in the Interviewers table) to cut "needs review".
