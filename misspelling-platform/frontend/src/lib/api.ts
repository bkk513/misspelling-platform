export type ApiError = Error & { status?: number; bodyText?: string };

let accessToken = "";

export function setAccessToken(token: string) {
  accessToken = token || "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const resp = await fetch(path, { ...init, headers });
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
  params?: unknown;
  result?: unknown;
  error?: unknown;
  progress?: unknown;
};
export type DeleteTaskResponse = { task_id: string; deleted: boolean; reason?: string };
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
export type VariantSuggestResponse = {
  word: string;
  variants: string[];
  source?: "llm" | "cache" | "heuristic";
  warnings?: string[];
};
export type TaskArtifactsResponse = {
  task_id: string;
  items: Array<{
    task_id: string;
    kind: string;
    filename: string;
    path: string;
    meta_json?: unknown;
    created_at?: string;
  }>;
};
export type LoginResponse = {
  access_token: string;
  token_type: string;
  user: { id: number; username: string; roles: string[] };
};
export type MeResponse = { id: number; username: string; roles: string[]; is_active: boolean };
export type AdminUsersResponse = {
  items: Array<{ id: number; username: string; is_active: boolean; is_admin: boolean; roles: string[]; created_at?: string }>;
};
export type AdminAuditResponse = {
  items: Array<{ id: number; actor_user_id?: number; action: string; target_type?: string; target_id?: string; meta_json?: unknown; created_at?: string }>;
};
export type AdminDataSourcesResponse = {
  items: Array<{ id: number; name: string; is_enabled: boolean; default_granularity: string; last_sync_at?: string; updated_at?: string }>;
};
export type AdminSettingsResponse = {
  allow_guest: boolean;
  llm_enabled: boolean;
  gbnc_enabled: boolean;
  admin_token_compat: boolean;
};

export const api = {
  getHealth: () => request<HealthResponse>("/health"),
  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }),
  me: () => request<MeResponse>("/api/auth/me"),
  createWordAnalysis: (word: string) =>
    request<CreateTaskResponse>(`/api/tasks/word-analysis?word=${encodeURIComponent(word)}`, { method: "POST" }),
  createSimulation: (n: number, steps: number) =>
    request<CreateTaskResponse>(`/api/tasks/simulation-run?n=${n}&steps=${steps}`, { method: "POST" }),
  listTasks: (limit = 20) => request<TaskListResponse>(`/api/tasks?limit=${limit}`),
  deleteTask: (taskId: string) => request<DeleteTaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }),
  getTask: (taskId: string) => request<TaskDetailResponse>(`/api/tasks/${encodeURIComponent(taskId)}`),
  getTaskEvents: (taskId: string, limit = 200) =>
    request<TaskEventsResponse>(`/api/tasks/${encodeURIComponent(taskId)}/events?limit=${limit}`),
  getTaskArtifacts: (taskId: string) =>
    request<TaskArtifactsResponse>(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`),
  getTimeSeriesMeta: (taskId: string) => request<TimeSeriesMeta>(`/api/time-series/${encodeURIComponent(taskId)}`),
  getTimeSeriesPoints: (taskId: string, variant: string) =>
    request<TimeSeriesPoints>(
      `/api/time-series/${encodeURIComponent(taskId)}/points?variant=${encodeURIComponent(variant)}`
    ),
  suggestVariants: (word: string, k = 12) =>
    request<VariantSuggestResponse>(
      `/api/lexicon/variants/suggest?word=${encodeURIComponent(word)}&k=${k}`,
      { method: "POST" }
    ),
  adminUsers: (limit = 50) => request<AdminUsersResponse>(`/api/admin/users?limit=${limit}`),
  adminCreateUser: (username: string, password: string, role: "admin" | "user") =>
    request<{ id: number; username: string; role: string }>("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role })
    }),
  adminResetPassword: (userId: number, newPassword: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${userId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: newPassword })
    }),
  adminUpdateUserActive: (userId: number, isActive: boolean) =>
    request<{ ok: boolean }>(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: isActive })
    }),
  adminAuditLogs: (limit = 120) => request<AdminAuditResponse>(`/api/admin/audit-logs?limit=${limit}`),
  adminDataSources: (limit = 80) => request<AdminDataSourcesResponse>(`/api/admin/data-sources?limit=${limit}`),
  adminSettings: () => request<AdminSettingsResponse>("/api/admin/settings"),
  fileUrl: (taskId: string, filename: string) => `/api/files/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`
};

export function describeApiError(error: unknown) {
  const err = error as ApiError;
  if (err?.status === 404) return "404: resource not found or feature not enabled.";
  if (err?.status === 500) return "500: backend exception. Check docker compose logs api/worker.";
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
