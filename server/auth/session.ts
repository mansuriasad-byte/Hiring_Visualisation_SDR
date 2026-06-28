import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Simple signed-token auth with two roles.
//   APP_PASSWORD    -> viewer (read-only: dashboard, pivots, candidate list)
//   ADMIN_PASSWORD  -> admin  (everything + edit, upload, calendar sync)
//
// If APP_PASSWORD is not set, auth is DISABLED — every request is treated as
// admin. This keeps local dev frictionless (mirrors the app's "runs without a
// token" behaviour); set the passwords in production to lock it down.
// ---------------------------------------------------------------------------

export type Role = 'viewer' | 'admin';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const appPassword = () => process.env.APP_PASSWORD?.trim() || '';
const adminPassword = () => process.env.ADMIN_PASSWORD?.trim() || '';

/** Auth is only enforced once a viewer password is configured. */
export function authEnabled(): boolean {
  return appPassword().length > 0;
}

// Secret used to sign tokens. Falls back to a deterministic value derived from
// the configured passwords so restarts don't invalidate everyone's session.
function secret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    `derived:${appPassword()}:${adminPassword()}` ||
    'insecure-dev-secret'
  );
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64url');

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Exchange a password for a role, or null if it matches neither. */
export function roleForPassword(password: string): Role | null {
  const p = (password ?? '').trim();
  if (!p) return null;
  if (adminPassword() && p === adminPassword()) return 'admin';
  if (appPassword() && p === appPassword()) return 'viewer';
  return null;
}

/** Issue a signed token: base64url(json).signature */
export function signToken(role: Role): string {
  const body = b64url(JSON.stringify({ role, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${sign(body)}`;
}

/** Verify a token and return its role, or null if invalid/expired. */
export function verifyToken(token: string | undefined): Role | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  // Constant-time compare against the expected signature.
  const expected = sign(body);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const { role, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof exp !== 'number' || Date.now() > exp) return null;
    if (role !== 'viewer' && role !== 'admin') return null;
    return role;
  } catch {
    return null;
  }
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return undefined;
}

/** Resolve the caller's role: admin when auth is disabled, else from token. */
export function roleOf(req: Request): Role | null {
  if (!authEnabled()) return 'admin';
  return verifyToken(bearer(req));
}

/** Gate: any signed-in user (viewer or admin). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const role = roleOf(req);
  if (!role) return res.status(401).json({ error: 'Sign in required.' });
  (req as any).role = role;
  next();
}

/** Gate: admin only. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = roleOf(req);
  if (!role) return res.status(401).json({ error: 'Sign in required.' });
  if (role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  (req as any).role = role;
  next();
}
