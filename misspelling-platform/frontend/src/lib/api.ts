export type ApiError = Error & { status?: number; bodyText?: string };

let accessToken = "";
const API_BASE = String(import.meta.env.VITE_API_BASE || "").trim().replace(/\/$/, "");

export function setAccessToken(token: string) {
  accessToken = token || "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const url = path.startsWith("http://") || path.startsWith("https://") ? path : `${API_BASE}${path}`;
  const resp = await fetch(url, { ...init, headers });
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
export type ExtendedHealthResponse = {
  status: string;
  db: boolean;
  redis: boolean;
  llm_enabled: boolean;
  gbnc_enabled: boolean;
  warnings: string[];
};
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
export type TaskBulkDeleteResponse = {
  requested: number;
  deleted: string[];
  skipped: Array<{ task_id: string; reason: string }>;
};
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
export type TimeSeriesListResponse = {
  items: Array<{
    series_id: number;
    source_name: string;
    canonical: string;
    granularity: string;
    window_start?: string;
    window_end?: string;
    owner_user_id?: number | null;
    task_id?: string;
    variant: string;
    point_count: number;
  }>;
};
export type SeriesBulkDeleteResponse = {
  requested: number;
  deleted: number[];
  skipped: Array<{ series_id: string; reason: string }>;
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
export type RegisterResponse = LoginResponse;
export type CaptchaResponse = { captcha_id: string; captcha_text: string; ttl_seconds: number };
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
export type AdminDiagnosticsResponse = {
  status: string;
  db: boolean;
  redis: boolean;
  worker: boolean;
  llm_enabled: boolean;
  gbnc_enabled: boolean;
  warnings: string[];
  components?: Record<string, unknown>;
  config_fingerprint?: Record<string, unknown>;
  last_data_pull?: unknown;
  recent_audit_logs?: unknown[];
};
export type ProjectItem = {
  id: number;
  owner_user_id?: number | null;
  name: string;
  description?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
};
export type ProjectListResponse = { items: ProjectItem[] };
export type ProjectTasksResponse = { project_id: number; items: TaskListItem[] };
export type ProjectTermsResponse = {
  project_id: number;
  items: Array<{ id: number; project_id: number; term_id: number; category?: string; canonical: string }>;
};
export type AnalyticsSummaryResponse = {
  project_id: number;
  total_terms: number;
  total_points: number;
  avg_variants: number;
  category_distribution: Record<string, number>;
};
export type AnalyticsClusterResponse = {
  method: string;
  project_id: number;
  k: number;
  features: string[];
  clusters: Array<{ cluster_id: number; size: number; items: Array<{ term_id: number; canonical: string; category: string }> }>;
};
export type ReportItem = {
  id: number;
  owner_user_id?: number | null;
  task_id?: string | null;
  project_id?: number | null;
  status: string;
  format: string;
  filename: string;
  created_at?: string;
  summary_json?: unknown;
};
export type ReportListResponse = { items: ReportItem[] };
export type GbncPullResponse = {
  word: string;
  source: string;
  cache_hit: boolean;
  warnings?: string[];
  error_reason?: string | null;
  series_id?: number | null;
  series_ids?: number[];
  point_count?: number;
};
export type GbncSeriesMetaResponse = {
  series_id: number;
  source: string;
  word: string;
  granularity: string;
  window_start: string;
  window_end: string;
  variants: string[];
  point_count: number;
  items: Array<{ series_id: number; variant: string; point_count: number }>;
  meta?: unknown;
};
export type GbncSeriesPointsResponse = { series_id: number; variant: string; items: Array<{ time: string; value: number }> };

export const api = {
  getHealth: () => request<HealthResponse>("/health"),
  getExtendedHealth: () => request<ExtendedHealthResponse>("/api/health/extended"),
  getCaptcha: () => request<CaptchaResponse>("/api/auth/captcha"),
  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }),
  register: (
    username: string,
    password: string,
    displayName?: string,
    email?: string,
    captchaId?: string,
    captchaCode?: string
  ) =>
    request<RegisterResponse>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        display_name: displayName || undefined,
        email: email || undefined,
        captcha_id: captchaId || "",
        captcha_code: captchaCode || ""
      })
    }),
  me: () => request<MeResponse>("/api/auth/me"),
  createWordAnalysis: (word: string, opts?: { startYear?: number; endYear?: number; smoothing?: number; corpus?: string; variants?: string[] }) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    return request<CreateTaskResponse>(`/api/tasks/word-analysis?${params.toString()}`, { method: "POST" });
  },
  createSimulation: (n: number, steps: number) =>
    request<CreateTaskResponse>(`/api/tasks/simulation-run?n=${n}&steps=${steps}`, { method: "POST" }),
  listTasks: (limit = 20, scope?: "all" | "guest" | `user:${number}`) =>
    request<TaskListResponse>(
      `/api/tasks?limit=${limit}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`
    ),
  bulkDeleteTasks: (taskIds: string[]) =>
    request<TaskBulkDeleteResponse>("/api/tasks/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_ids: taskIds })
    }),
  deleteTask: (taskId: string) => request<DeleteTaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }),
  retryTask: (taskId: string) =>
    request<{ ok: boolean; task_id?: string; parent_task_id?: string; reason?: string }>(
      `/api/tasks/${encodeURIComponent(taskId)}/retry`,
      { method: "POST" }
    ),
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
  listTimeSeries: (limit = 100, scope?: "all" | "guest" | `user:${number}`) =>
    request<TimeSeriesListResponse>(
      `/api/time-series?limit=${limit}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`
    ),
  bulkDeleteSeries: (seriesIds: number[]) =>
    request<SeriesBulkDeleteResponse>("/api/time-series/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ series_ids: seriesIds })
    }),
  suggestVariants: (word: string, k = 12) =>
    request<VariantSuggestResponse>(
      `/api/lexicon/variants/suggest?word=${encodeURIComponent(word)}&k=${k}`,
      { method: "POST" }
    ),
  enrichTerm: (word: string) =>
    request<{ term_id: number; word: string; attributes: unknown; source: string }>(
      `/api/lexicon/term/enrich?word=${encodeURIComponent(word)}`,
      { method: "POST" }
    ),
  listLexiconTerms: (limit = 50, q = "") =>
    request<{ items: Array<{ id: number; canonical: string; category?: string; owner_user_id?: number | null }>; seed_hits?: unknown[] }>(
      `/api/lexicon/terms?limit=${limit}&q=${encodeURIComponent(q)}`
    ),
  getLexiconTerm: (termId: number) => request<{ id: number; found?: boolean; canonical?: string; attributes?: unknown; variants?: unknown[] }>(`/api/lexicon/${termId}`),
  pullGbnc: (word: string, opts?: { startYear?: number; endYear?: number; corpus?: string; smoothing?: number; variants?: string[] }) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    return request<GbncPullResponse>(`/api/data/gbnc/pull?${params.toString()}`, { method: "POST" });
  },
  getGbncSeries: (seriesId: number) => request<GbncSeriesMetaResponse>(`/api/data/gbnc/series/${seriesId}`),
  getGbncSeriesPoints: (seriesId: number, variant?: string) =>
    request<GbncSeriesPointsResponse>(
      `/api/data/gbnc/series/${seriesId}/points${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`
    ),
  createProject: (name: string, description?: string) =>
    request<{ project_id: number; name: string; description?: string }>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description })
    }),
  listProjects: (limit = 100, scope?: "all" | "guest") =>
    request<ProjectListResponse>(`/api/projects?limit=${limit}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`),
  addProjectTerms: (projectId: number, words: string[], category?: string) =>
    request<{ project_id: number; added: number }>(`/api/projects/${projectId}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words, category })
    }),
  listProjectTerms: (projectId: number) => request<ProjectTermsResponse>(`/api/projects/${projectId}/terms`),
  bindProjectTask: (projectId: number, taskId: string) =>
    request<{ ok: boolean; project_id: number; task_id: string }>(`/api/projects/${projectId}/tasks/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId })
    }),
  listProjectTasks: (projectId: number, limit = 100) => request<ProjectTasksResponse>(`/api/projects/${projectId}/tasks?limit=${limit}`),
  analyticsSummary: (projectId: number) =>
    request<AnalyticsSummaryResponse>(`/api/analytics/summary?project_id=${projectId}`),
  analyticsCluster: (projectId: number, k = 3) =>
    request<AnalyticsClusterResponse>("/api/analytics/cluster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, k })
    }),
  createTaskReport: (taskId: string) =>
    request<{ report_id: number; task_id: string; filename: string; download_url: string }>(
      `/api/reports/export/task/${encodeURIComponent(taskId)}`,
      { method: "POST" }
    ),
  createProjectReport: (projectId: number) =>
    request<{ report_id: number; project_id: number; task_id: string; filename: string; download_url: string }>(
      `/api/reports/export/project/${projectId}`,
      { method: "POST" }
    ),
  listReports: (limit = 100, scope?: "all" | "guest") =>
    request<ReportListResponse>(`/api/reports?limit=${limit}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`),
  getReport: (reportId: number) => request<ReportItem>(`/api/reports/${reportId}`),
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
  adminDiagnostics: () => request<AdminDiagnosticsResponse>("/api/admin/diagnostics"),
  adminPurge: (scope: "guest" | "user", what: string[], userId?: number) =>
    request<{ ok: boolean; deleted: Record<string, number> }>("/api/admin/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, user_id: userId, what })
    }),
  fileUrl: (taskId: string, filename: string) => `/api/files/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`
};

export function describeApiError(error: unknown) {
  const err = error as ApiError;
  if (err?.status === 404) return "404: resource not found or feature not enabled.";
  if (err?.status === 500) return "500: backend exception. Check docker compose logs api/worker.";
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
