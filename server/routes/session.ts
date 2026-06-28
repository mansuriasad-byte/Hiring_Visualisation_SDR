import { Router } from 'express';
import { authEnabled, roleForPassword, signToken, roleOf } from '../auth/session.ts';

const router = Router();

/** Whether a password is required, plus the caller's current role (if any). */
router.get('/me', (req, res) => {
  res.json({ authRequired: authEnabled(), role: roleOf(req) });
});

/** Exchange a password for a token + role. */
router.post('/login', (req, res) => {
  if (!authEnabled()) {
    // Auth disabled — hand back an admin token so the client behaves uniformly.
    return res.json({ token: signToken('admin'), role: 'admin', authRequired: false });
  }
  const role = roleForPassword(String(req.body?.password ?? ''));
  if (!role) return res.status(401).json({ error: 'Incorrect password.' });
  res.json({ token: signToken(role), role, authRequired: true });
});

export default router;
