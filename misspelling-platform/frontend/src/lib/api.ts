export type ApiError = Error & { status?: number; bodyText?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, init);
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

export const api = {
  getHealth: () => request<HealthResponse>("/health"),
  createWordAnalysis: (word: string) =>
    request<CreateTaskResponse>(`/api/tasks/word-analysis?word=${encodeURIComponent(word)}`, { method: "POST" }),
  createSimulation: (n: number, steps: number) =>
    request<CreateTaskResponse>(`/api/tasks/simulation-run?n=${n}&steps=${steps}`, { method: "POST" }),
  listTasks: (limit = 20) => request<TaskListResponse>(`/api/tasks?limit=${limit}`),
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
  fileUrl: (taskId: string, filename: string) => `/api/files/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`
};

export function describeApiError(error: unknown) {
  const err = error as ApiError;
  if (err?.status === 404) return "404: resource not found or feature not enabled.";
  if (err?.status === 500) return "500: backend exception. Check docker compose logs api/worker.";
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
