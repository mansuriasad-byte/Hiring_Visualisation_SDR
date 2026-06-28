import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOKEN_PATH = resolve(projectRoot, 'data/google-token.json');

// On Render (ephemeral FS) the token lives in GOOGLE_TOKEN_JSON env var.
// Locally it falls back to data/google-token.json on disk.

export function oauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function hasToken(): boolean {
  return Boolean(process.env.GOOGLE_TOKEN_JSON) || existsSync(TOKEN_PATH);
}

function loadToken(): Credentials | null {
  if (process.env.GOOGLE_TOKEN_JSON) {
    try { return JSON.parse(process.env.GOOGLE_TOKEN_JSON); } catch { return null; }
  }
  if (!existsSync(TOKEN_PATH)) return null;
  return JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
}

function saveToken(tokens: Credentials): void {
  const merged = { ...(loadToken() ?? {}), ...tokens };
  // When running with GOOGLE_TOKEN_JSON, update the env var in-memory so the
  // current process keeps using the refreshed token. The operator must copy
  // the logged value back into their hosting env after the first refresh.
  if (process.env.GOOGLE_TOKEN_JSON) {
    const json = JSON.stringify(merged);
    process.env.GOOGLE_TOKEN_JSON = json;
    console.log('[oauth] Token refreshed. Update GOOGLE_TOKEN_JSON env var to:\n' + json);
    return;
  }
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
}

export function createClient(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback',
  );
}

/** Consent URL. `prompt: 'consent'` + offline access guarantees a refresh token. */
export function getAuthUrl(): string {
  return createClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

/** Exchange the callback code for tokens and persist them. */
export async function exchangeCode(code: string): Promise<void> {
  const client = createClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned. Revoke prior access and re-authorize with prompt=consent.');
  }
  saveToken(tokens);
}

/**
 * Authenticated client with the stored refresh token. Auto-refreshes access
 * tokens and persists the rotation. Throws if not yet authorized.
 */
export function getAuthedClient(): OAuth2Client {
  const tokens = loadToken();
  if (!tokens) throw new Error('Not authorized yet. Visit /auth/google to connect Google Calendar.');
  const client = createClient();
  client.setCredentials(tokens);
  client.on('tokens', (t) => saveToken(t));
  return client;
}
