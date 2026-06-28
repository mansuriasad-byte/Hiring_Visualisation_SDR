import { Router } from 'express';
import { oauthConfigured, hasToken, getAuthUrl, exchangeCode } from '../google/oauth.ts';

const router = Router();

/** Status: is OAuth configured, and have we stored a refresh token yet? */
router.get('/google/status', (_req, res) => {
  res.json({ configured: oauthConfigured(), connected: hasToken() });
});

/** Kick off consent — open this in a browser as Asad. */
router.get('/google', (_req, res) => {
  if (!oauthConfigured()) {
    return res.status(400).send('Google OAuth not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.');
  }
  res.redirect(getAuthUrl());
});

/** OAuth redirect target — exchanges the code and stores the refresh token. */
router.get('/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return res.status(400).send('Missing authorization code.');
  try {
    await exchangeCode(code);
    res.send('<h2>✅ Google Calendar connected.</h2><p>You can close this tab and return to the app.</p>');
  } catch (err) {
    res.status(500).send(`Authorization failed: ${(err as Error).message}`);
  }
});

export default router;
