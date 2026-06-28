import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import uploadsRouter from './routes/uploads.ts';
import authRouter from './routes/auth.ts';
import sessionRouter from './routes/session.ts';
import calendarRouter from './routes/calendar.ts';
import dataRouter from './routes/data.ts';
import { airtableConfigured } from './airtable/client.ts';
import { oauthConfigured, hasToken } from './google/oauth.ts';
import { authEnabled, requireAdmin } from './auth/session.ts';

const app = express();

// CORS: allow a comma-separated CORS_ORIGINS allowlist in production (Vercel
// frontend), otherwise reflect all origins (local dev).
const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(origins?.length ? { origin: origins } : {}));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    authRequired: authEnabled(),
    airtable: airtableConfigured() ? 'configured' : 'dry-run (no token)',
    google: !oauthConfigured() ? 'not configured' : hasToken() ? 'connected' : 'configured (not authorized)',
  });
});

app.use('/api/auth', sessionRouter);
app.use('/api/uploads', requireAdmin, uploadsRouter); // writes to Airtable — admin only
app.use('/api/calendar', calendarRouter);             // per-route gates inside
app.use('/api/data', dataRouter);                     // per-route gates inside
app.use('/auth', authRouter);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Hiring Pipeline Tracker API on http://localhost:${port}`);
  console.log(airtableConfigured() ? 'Airtable: configured' : 'Airtable: not configured — uploads run in dry-run mode');
});
