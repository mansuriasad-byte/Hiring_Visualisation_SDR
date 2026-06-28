// Thin client over the Express data API.
// In dev, Vite proxies /api -> :3000. In prod, set VITE_API_BASE to the Render URL.

const API_BASE = (import.meta as any).env?.VITE_API_BASE?.replace(/\/$/, '') ?? '';

// ---- token storage -------------------------------------------------------
const TOKEN_KEY = 'ht_token';
const ROLE_KEY = 'ht_role';
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const getRole = () => localStorage.getItem(ROLE_KEY) ?? '';
export const setSession = (token: string, role: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
};

// ---- core fetch ----------------------------------------------------------
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new Event('ht-unauthorized'));
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function jsonReq<T>(path: string, method: string, body: unknown): Promise<T> {
  return req<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---- types ---------------------------------------------------------------
export interface Filters {
  scope?: string; geo?: string; role?: string; source?: string; status?: string;
  dateFrom?: string; dateTo?: string;
  [key: string]: string | undefined;
}

export interface Metrics {
  filters: { scope: string; role: string | null; geo: string | null };
  candidates: {
    total: number;
    byStage: Record<string, number>;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    byGeo: Record<string, number>;
    byRole: Record<string, number>;
    funnel: { stage: string; reached: number }[];
    funnelUnplaced: number;
  };
  interviews: {
    total: number; inScope: number; matched: number; needsReview: number;
    byRound: Record<string, number>;
  };
}

export type Candidate = Record<string, any> & { id: string };

// ---- Pivot types ---------------------------------------------------------
export interface WeekSourceTable {
  id: string; title: string;
  cols: string[];
  rows: { week: string; cells: Record<string, number>; total: number }[];
  colTotals: Record<string, number>;
  grandTotal: number;
}

export interface SourceFunnelRow {
  source: string; applications: number; r1: number; r2: number; offers: number; accepted: number;
  appToR1: number; r1ToR2: number; r2ToOffer: number; offerToAccept: number; overall: number;
}

export interface VelocityRow {
  transition: string; avg: number | null; median: number | null; count: number;
}

export interface InterviewerLoadData {
  weeks: string[];
  rows: { interviewer: string; cells: Record<string, number>; total: number }[];
}

export interface PivotResponse {
  geo: string;
  candidateCount: number;
  interviewCount: number;
  weekSourceTables: WeekSourceTable[];
  sourceFunnel: SourceFunnelRow[];
  velocity: VelocityRow[];
  interviewerLoad: InterviewerLoadData;
}

export interface CalendarStatus {
  ready: boolean; google: string; airtable: string;
  sources: { id: string; fields: Record<string, any> }[];
}

// ---- query string --------------------------------------------------------
const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---- auth ----------------------------------------------------------------
export const fetchMe = () =>
  req<{ authRequired: boolean; role: string | null }>('/api/auth/me');
export const login = (password: string) =>
  jsonReq<{ token: string; role: string; authRequired: boolean }>('/api/auth/login', 'POST', { password });

// ---- data ----------------------------------------------------------------
export const fetchMetrics = (f: Filters) => req<Metrics>(`/api/data/metrics${qs(f)}`);
export const fetchCandidates = (f: Filters) =>
  req<{ count: number; candidates: Candidate[] }>(`/api/data/candidates${qs(f)}`);
export const fetchPivot = (geo?: string) =>
  req<PivotResponse>(`/api/data/pivot${geo ? `?geo=${geo}` : ''}`);
export const updateCandidate = (id: string, fields: Record<string, unknown>) =>
  jsonReq<{ ok: boolean; id: string; fields: Record<string, any> }>(`/api/data/candidates/${id}`, 'PATCH', fields);

// ---- calendar ------------------------------------------------------------
export const fetchCalendarStatus = () => req<CalendarStatus>('/api/calendar/status');
export const runCalendarSync = (body: Record<string, unknown> = {}) =>
  jsonReq<any>('/api/calendar/sync', 'POST', body);

// ---- uploads -------------------------------------------------------------
export type UploadType = 'ats' | 'referral' | 'offer';
function uploadForm(path: string, file: File, type: UploadType, role?: string, geo?: string) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  if (role) fd.append('role', role);
  if (geo) fd.append('geo', geo);
  return req<any>(path, { method: 'POST', body: fd });
}
export const uploadPreview = (file: File, type: UploadType, role?: string, geo?: string) =>
  uploadForm('/api/uploads/preview', file, type, role, geo);
export const uploadCommit = (file: File, type: UploadType, role?: string, geo?: string) =>
  uploadForm('/api/uploads', file, type, role, geo);
