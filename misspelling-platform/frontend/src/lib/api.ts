export type ApiError = Error & { status?: number; bodyText?: string };

const API_BASE = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");

function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(apiUrl(path), init);
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} ${resp.statusText}`) as ApiError;
    err.status = resp.status;
    err.bodyText = text;
    throw err;
  }
  return (text ? JSON.parse(text) : null) as T;
}

function authHeaders(accessToken = "", adminToken = ""): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (adminToken) headers["X-Admin-Token"] = adminToken;
  return headers;
}

export type HealthResponse = { status: string; db: boolean };
export type AuthLoginResponse = {
  access_token: string;
  token_type: string;
  user: { id: number; username: string; roles: string[] };
};
export type AuthMeResponse = {
  user: { id: number; username: string; display_name?: string | null; roles: string[] };
};
export type CreateTaskResponse = { task_id: string };
export type WordAnalysisCreateArgs = {
  word: string;
  start_year?: number;
  end_year?: number;
  smoothing?: number;
  corpus?: string;
  variants?: string[];
};
export type TaskListItem = {
  task_id: string;
  task_type: string;
  status: string;
  display_name?: string;
  params_json?: unknown;
  created_at?: string;
  updated_at?: string;
};
export type TaskListResponse = { items: TaskListItem[] };
export type TaskDetailResponse = {
  task_id: string;
  state: string;
  display_name?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  progress?: unknown;
};
export type TaskEventsResponse = {
  task_id: string;
  items: Array<{ event_type: string; message: string; meta?: unknown; created_at?: string }>;
};
export type TimeSeriesMeta = {
  task_id: string;
  source: string;
  word: string;
  granularity: string;
  variants: string[];
  point_count: number;
  items: Array<{ series_id: number; variant: string; point_count: number }>;
};
export type TimeSeriesPoints = {
  task_id: string;
  variant: string;
  series_id: number;
  items: Array<{ time: string; value: number }>;
};
export type LexiconSuggestResponse = {
  word: string;
  term_id?: number;
  variants: string[];
  source: "llm" | "cache" | string;
  version_id?: number | null;
  llm_enabled?: boolean;
  warning?: string | null;
  warnings?: string[];
  llm_error?: string | null;
};
export type AdminAuditLogItem = {
  id: number;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  meta?: unknown;
  created_at?: string;
};
export type AdminAuditLogsResponse = { items: AdminAuditLogItem[] };
export type AdminUsersResponse = {
  items: Array<{ id: number; username: string; display_name?: string | null; is_active: number | boolean; is_admin: number | boolean; created_at?: string; roles: string[] }>;
};
export type AdminGbncSeriesResponse = {
  items: Array<{ series_id: number; canonical: string; variant: string; source_name: string; granularity: string; updated_at?: string; corpus?: string; smoothing?: string; point_count: number }>;
};
export type GbncPullResponse = {
  source: string;
  cached: boolean;
  term: string;
  variants: string[];
  variant_source?: string;
  items: Array<{ series_id: number; variant: string; point_count: number }>;
};
export type GbncSeriesDetail = {
  series_id: number;
  source: string;
  word: string;
  variant: string;
  granularity: string;
  units?: string;
  window_start?: string;
  window_end?: string;
  updated_at?: string;
  point_count: number;
  meta?: unknown;
};
export type GbncSeriesPoints = { series_id: number; items: Array<{ time: string; value: number }> };

export const api = {
  baseUrl: API_BASE,
  getHealth: () => request<HealthResponse>("/health"),
  authLogin: (username: string, password: string) =>
    request<AuthLoginResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  authMe: (accessToken: string) =>
    request<AuthMeResponse>("/api/auth/me", {
      headers: authHeaders(accessToken),
    }),
  createWordAnalysis: (args: string | WordAnalysisCreateArgs) => {
    const payload = typeof args === "string" ? { word: args } : args;
    const q = new URLSearchParams();
    q.set("word", payload.word);
    if (payload.start_year != null) q.set("start_year", String(payload.start_year));
    if (payload.end_year != null) q.set("end_year", String(payload.end_year));
    if (payload.smoothing != null) q.set("smoothing", String(payload.smoothing));
    if (payload.corpus) q.set("corpus", payload.corpus);
    for (const v of payload.variants ?? []) q.append("variant", v);
    return request<CreateTaskResponse>(`/api/tasks/word-analysis?${q.toString()}`, { method: "POST" });
  },
  createSimulation: (n: number, steps: number) =>
    request<CreateTaskResponse>(`/api/tasks/simulation-run?n=${n}&steps=${steps}`, { method: "POST" }),
  listTasks: (limit = 20) => request<TaskListResponse>(`/api/tasks?limit=${limit}`),
  getTask: (taskId: string) => request<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(taskId)}`),
  deleteTask: (taskId: string) => request<{ ok: boolean; task_id: string; status: string }>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }),
  getTaskEvents: (taskId: string, limit = 200) =>
    request<TaskEventsResponse>(`/api/tasks/${encodeURIComponent(taskId)}/events?limit=${limit}`),
  getTimeSeriesMeta: (taskId: string) => request<TimeSeriesMeta>(`/api/time-series/${encodeURIComponent(taskId)}`),
  getTimeSeriesPoints: (taskId: string, variant: string) =>
    request<TimeSeriesPoints>(
      `/api/time-series/${encodeURIComponent(taskId)}/points?variant=${encodeURIComponent(variant)}`
    ),
  suggestVariants: (word: string, k = 20) =>
    request<LexiconSuggestResponse>(`/api/lexicon/variants/suggest?word=${encodeURIComponent(word)}&k=${k}`, { method: "POST" }),
  gbncPull: (args: { word: string; start_year: number; end_year: number; corpus: string; smoothing: number }) =>
    request<GbncPullResponse>(
      `/api/data/gbnc/pull?word=${encodeURIComponent(args.word)}&start_year=${args.start_year}&end_year=${args.end_year}&corpus=${encodeURIComponent(args.corpus)}&smoothing=${args.smoothing}`,
      { method: "POST" }
    ),
  getGbncSeries: (seriesId: number) => request<GbncSeriesDetail>(`/api/data/gbnc/series/${seriesId}`),
  getGbncSeriesPoints: (seriesId: number) => request<GbncSeriesPoints>(`/api/data/gbnc/series/${seriesId}/points`),
  adminListAuditLogs: (limit = 50, accessToken = "", adminToken = "") =>
    request<AdminAuditLogsResponse>(`/api/admin/audit-logs?limit=${limit}`, {
      headers: authHeaders(accessToken, adminToken),
    }),
  adminListUsers: (limit = 100, accessToken = "", adminToken = "") =>
    request<AdminUsersResponse>(`/api/admin/users?limit=${limit}`, { headers: authHeaders(accessToken, adminToken) }),
  adminListGbncSeries: (limit = 100, accessToken = "", adminToken = "") =>
    request<AdminGbncSeriesResponse>(`/api/admin/gbnc-series?limit=${limit}`, { headers: authHeaders(accessToken, adminToken) }),
  adminAddLexiconVariants: (payload: { word?: string; term_id?: number; variants: string[] }, accessToken = "", adminToken = "") =>
    request<{ ok: boolean; term_id: number; version_id?: number | null; count: number; variants: string[] }>(
      "/api/admin/lexicon/variants",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(accessToken, adminToken),
        },
        body: JSON.stringify(payload),
      }
    ),
  fileUrl: (taskId: string, filename: string) => apiUrl(`/api/files/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`)
};

export function describeApiError(error: unknown) {
  const err = error as ApiError;
  if (err?.status === 401) return "401: unauthorized. Please login or check admin token compatibility mode.";
  if (err?.status === 404) return "404: resource not found or feature not enabled.";
  if (err?.status === 500) return "500: backend exception. Check docker compose logs api/worker.";
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
