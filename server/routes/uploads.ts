import { Router } from 'express';
import multer from 'multer';
import { parseCsv } from '../services/csv.ts';
import { ingest } from '../services/ingest.ts';
import { parseAtsExport } from '../services/parsers/ats.ts';
import { parseReferralDump } from '../services/parsers/referral.ts';
import { parseOfferStatus } from '../services/parsers/offer.ts';
import type { UploadType } from '../types.ts';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const TYPES: UploadType[] = ['ats', 'referral', 'offer'];

function validate(req: any): { type: UploadType; role?: string; geo?: string } | { error: string } {
  const type = String(req.body?.type ?? '').toLowerCase() as UploadType;
  if (!TYPES.includes(type)) return { error: `"type" must be one of: ${TYPES.join(', ')}` };
  if (type === 'ats') {
    const role = req.body?.role?.trim();
    const geo = req.body?.geo?.trim();
    if (!role || !geo) return { error: 'ATS uploads require "role" and "geo" (the export has no role column).' };
    return { type, role, geo };
  }
  return { type };
}

/**
 * POST /api/uploads/preview
 * form-data: file, type[, role, geo]. Parses without writing; returns headers,
 * the first rows, and the normalized parse stats (scope tally, flagged counts).
 */
router.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field "file").' });
  const v = validate(req);
  if ('error' in v) return res.status(422).json(v);

  try {
    const content = req.file.buffer.toString('utf-8');
    const { headers, rows } = parseCsv(content);
    const result =
      v.type === 'ats' ? parseAtsExport(content, { role: v.role!, geo: v.geo!, fileName: req.file.originalname })
      : v.type === 'referral' ? parseReferralDump(content, req.file.originalname)
      : parseOfferStatus(content, req.file.originalname);

    return res.json({
      type: v.type,
      filename: req.file.originalname,
      headers,
      previewRows: rows.slice(0, 5),
      stats: result.stats,
      sampleRecords: result.records.slice(0, 5),
    });
  } catch (err) {
    return res.status(422).json({ error: `Failed to parse CSV: ${(err as Error).message}` });
  }
});

/**
 * POST /api/uploads
 * form-data: file, type[, role, geo]. Parses + dedups into Airtable (or returns
 * a dry-run summary if no Airtable token is configured).
 */
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field "file").' });
  const v = validate(req);
  if ('error' in v) return res.status(422).json(v);

  try {
    const summary = await ingest(req.file.buffer.toString('utf-8'), {
      type: v.type,
      role: v.role,
      geo: v.geo,
      fileName: req.file.originalname,
    });
    return res.json({ ok: true, ...summary });
  } catch (err) {
    return res.status(500).json({ error: `Upload failed: ${(err as Error).message}` });
  }
});

export default router;
