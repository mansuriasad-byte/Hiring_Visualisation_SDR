import { Router } from 'express';
import { oauthConfigured, hasToken } from '../google/oauth.ts';
import { airtableConfigured, listCalendarSources } from '../airtable/client.ts';
import { syncCalendars, reconcileUnmatchedInterviews } from '../google/calendarSync.ts';
import { requireAuth, requireAdmin } from '../auth/session.ts';

const router = Router();

/** Sync readiness + configured calendar sources. */
router.get('/status', requireAuth, async (_req, res) => {
  const ready = oauthConfigured() && hasToken() && airtableConfigured();
  let sources: unknown[] = [];
  try {
    if (airtableConfigured()) sources = await listCalendarSources();
  } catch { /* ignore */ }
  res.json({
    ready,
    google: !oauthConfigured() ? 'not configured' : hasToken() ? 'connected' : 'configured (not authorized)',
    airtable: airtableConfigured() ? 'configured' : 'not configured',
    sources,
  });
});

/** Run a sync. Body (optional): { windowDays }. Admin only. */
router.post('/sync', requireAdmin, async (req, res) => {
  if (!airtableConfigured()) return res.status(400).json({ error: 'Airtable not configured.' });
  if (!oauthConfigured()) return res.status(400).json({ error: 'Google OAuth not configured (set GOOGLE_CLIENT_ID/SECRET).' });
  if (!hasToken()) return res.status(400).json({ error: 'Google not authorized. Visit /auth/google first.' });

  try {
    const summary = await syncCalendars({
      since: typeof req.body?.since === 'string' ? req.body.since : undefined,
      windowDays: Number(req.body?.windowDays) || undefined,
      forwardDays: Number(req.body?.forwardDays) || undefined,
      dryRun: Boolean(req.body?.dryRun),
    });
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: `Sync failed: ${(err as Error).message}` });
  }
});

/** Reconcile unmatched interviews → create candidate stubs. Admin only. */
router.post('/reconcile', requireAdmin, async (_req, res) => {
  if (!airtableConfigured()) return res.status(400).json({ error: 'Airtable not configured.' });
  try {
    const result = await reconcileUnmatchedInterviews();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: `Reconcile failed: ${(err as Error).message}` });
  }
});

export default router;
