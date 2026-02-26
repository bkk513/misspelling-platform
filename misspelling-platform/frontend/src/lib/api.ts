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

export type HealthResponse = { status: string; db: boolean };
export type CreateTaskResponse = { task_id: string };
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

export const api = {
  baseUrl: API_BASE,
  getHealth: () => request<HealthResponse>("/health"),
  createWordAnalysis: (word: string) =>
    request<CreateTaskResponse>(`/api/tasks/word-analysis?word=${encodeURIComponent(word)}`, { method: "POST" }),
  createSimulation: (n: number, steps: number) =>
    request<CreateTaskResponse>(`/api/tasks/simulation-run?n=${n}&steps=${steps}`, { method: "POST" }),
  listTasks: (limit = 20) => request<TaskListResponse>(`/api/tasks?limit=${limit}`),
  getTask: (taskId: string) => request<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(taskId)}`),
  getTaskEvents: (taskId: string, limit = 200) =>
    request<TaskEventsResponse>(`/api/tasks/${encodeURIComponent(taskId)}/events?limit=${limit}`),
  getTimeSeriesMeta: (taskId: string) => request<TimeSeriesMeta>(`/api/time-series/${encodeURIComponent(taskId)}`),
  getTimeSeriesPoints: (taskId: string, variant: string) =>
    request<TimeSeriesPoints>(
      `/api/time-series/${encodeURIComponent(taskId)}/points?variant=${encodeURIComponent(variant)}`
    ),
  suggestVariants: (word: string, k = 20) =>
    request<LexiconSuggestResponse>(`/api/lexicon/variants/suggest?word=${encodeURIComponent(word)}&k=${k}`, { method: "POST" }),
  adminListAuditLogs: (limit = 50, adminToken = "") =>
    request<AdminAuditLogsResponse>(`/api/admin/audit-logs?limit=${limit}`, {
      headers: { "X-Admin-Token": adminToken },
    }),
  adminAddLexiconVariants: (payload: { word?: string; term_id?: number; variants: string[] }, adminToken = "") =>
    request<{ ok: boolean; term_id: number; version_id?: number | null; count: number; variants: string[] }>(
      "/api/admin/lexicon/variants",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": adminToken,
        },
        body: JSON.stringify(payload),
      }
    ),
  fileUrl: (taskId: string, filename: string) => apiUrl(`/api/files/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`)
};

export function describeApiError(error: unknown) {
  const err = error as ApiError;
  if (err?.status === 401) return "401: unauthorized. Check X-Admin-Token / ADMIN_TOKEN configuration.";
  if (err?.status === 404) return "404: resource not found or feature not enabled.";
  if (err?.status === 500) return "500: backend exception. Check docker compose logs api/worker.";
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
