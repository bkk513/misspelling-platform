export type ApiError = Error & { status?: number; bodyText?: string };

let accessToken = "";
let guestKey = "";
const API_BASE = String(import.meta.env.VITE_API_BASE || "").trim().replace(/\/$/, "");

export function setAccessToken(token: string) {
  accessToken = token || "";
}

export function setGuestKey(key: string) {
  guestKey = String(key || "").trim();
}

function resolveGuestKey() {
  return (
    guestKey ||
    (typeof window !== "undefined" ? String(window.localStorage.getItem("mp-guest-key") || "").trim() : "")
  );
}

function withTurnstileHeaders(turnstileToken: string, headers?: HeadersInit) {
  const merged = new Headers(headers || {});
  if (turnstileToken) merged.set("X-Turnstile-Token", turnstileToken);
  return merged;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (!accessToken && !headers.has("X-Guest-Key")) {
    const fallbackGuestKey = resolveGuestKey();
    if (fallbackGuestKey) {
      headers.set("X-Guest-Key", fallbackGuestKey);
    }
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
export type AlgorithmTaskOptions = {
  startYear?: number;
  endYear?: number;
  smoothing?: number;
  corpus?: string;
  variants?: string[];
  originYear?: number;
};
export type SimulationTaskOptions = AlgorithmTaskOptions & {
  topology?: string;
  nAgents?: number;
  searchRounds?: number;
  repeats?: number;
  fitProfile?: string;
  trendWindow?: number;
  wsK?: number;
  wsP?: number;
  baM?: number;
  randomSeed?: number;
  interventionYear?: number;
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
    task_type?: string;
    task_created_at?: string;
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
  source?: "llm" | "cache" | "heuristic" | "dictionary";
  warnings?: string[];
};
export type OriginYearSuggestResponse = {
  word: string;
  variants: string[];
  suggested_year?: number | null;
  basis_year?: number | null;
  correct_first_year?: number | null;
  source?: "seed" | "gbnc" | "llm" | "heuristic";
  dataset_source?: string;
  reasoning?: string;
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
export type ProjectCohortItem = {
  id: number;
  project_id: number;
  name: string;
  description?: string | null;
  color?: string | null;
  rule_json?: unknown;
  sort_order: number;
  is_active: boolean | number;
  created_at?: string;
  updated_at?: string;
};
export type ProjectMembershipItem = {
  id: number;
  project_id: number;
  term_id: number;
  canonical: string;
  lexicon_category?: string | null;
  cohort_id: number;
  cohort_name: string;
  cohort_color?: string | null;
  membership_weight: number;
  source: string;
  confidence: number;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
};
export type ProjectTermsResponse = {
  project_id: number;
  items: Array<{
    id: number;
    project_id: number;
    term_id: number;
    category?: string | null;
    canonical: string;
    cohorts?: Array<{
      membership_id: number;
      cohort_id: number;
      cohort_name: string;
      cohort_color?: string | null;
      weight: number;
      confidence: number;
      source: string;
    }>;
    cohort_count?: number;
    primary_cohort?: string | null;
  }>;
};
export type ProjectCohortsResponse = { project_id: number; items: ProjectCohortItem[] };
export type ProjectMembershipsResponse = { project_id: number; items: ProjectMembershipItem[] };
export type AnalyticsSummaryResponse = {
  project_id: number;
  total_terms: number;
  total_points: number;
  avg_variants: number;
  category_distribution: Record<string, number>;
  total_cohorts: number;
  cohort_distribution: Record<string, number>;
  terms_with_points: number;
  coverage_ratio: number;
  avg_memberships_per_term: number;
};
export type AnalyticsClusterResponse = {
  method: string;
  project_id: number;
  k: number;
  features: string[];
  terms: number;
  diagnostics?: { silhouette: number | null; pca_explained_variance: number[] };
  clusters: Array<{
    cluster_id: number;
    size: number;
    centroid?: number[];
    items: Array<{
      term_id: number;
      canonical: string;
      category: string;
      primary_cohort?: string | null;
      embedding?: { x: number; y: number };
    }>;
  }>;
};
export type AnalyticsCohortCompareResponse = {
  method: string;
  project_id: number;
  cohort_a: string;
  cohort_b: string;
  overlap_terms: number;
  cohort_sizes: Record<string, number>;
  metrics: Array<{
    metric: string;
    n_a: number;
    n_b: number;
    mean_a: number;
    mean_b: number;
    diff_mean: number;
    effect_size_d: number;
    perm_p_value: number;
    welch_t: number;
    welch_p_value: number;
    bootstrap_ci95: number[];
    fdr_q_value: number;
    is_significant: boolean;
  }>;
};
export type AnalyticsTemporalPatternsResponse = {
  method: string;
  project_id: number;
  n_clusters: number;
  year_range: number[];
  warnings?: string[];
  clusters: Array<{
    cluster_id: number;
    size: number;
    medoid_term_id: number;
    medoid_canonical: string;
    terms: Array<{ term_id: number; canonical: string }>;
    mean_trajectory: Array<{ year: number; value: number }>;
  }>;
};
export type AnalyticsExplainabilityResponse = {
  method: string;
  project_id: number;
  labels?: string[];
  target_cohort?: string;
  warnings: string[];
  accuracy: { mean: number; std: number; folds: number } | null;
  feature_importance: Array<{ feature: string; importance_mean: number; importance_std: number }>;
  target_preview: Array<{ term_id: number; canonical: string; true_cohort: string; target_probability: number }>;
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
export type VariantCacheItem = {
  id: number;
  owner_user_id?: number;
  username?: string;
  word: string;
  variant: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
};
export type VariantCacheListResponse = { items: VariantCacheItem[] };
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

function extractObservedYear(value: string | number | undefined | null) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

async function fallbackOriginYearSuggestion(
  word: string,
  opts?: { variants?: string[]; startYear?: number; endYear?: number; corpus?: string; smoothing?: number }
): Promise<OriginYearSuggestResponse> {
  const params = new URLSearchParams();
  params.set("word", word);
  if (opts?.startYear !== undefined) params.set("start_year", String(opts.startYear));
  if (opts?.endYear !== undefined) params.set("end_year", String(opts.endYear));
  if (opts?.corpus) params.set("corpus", opts.corpus);
  if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
  if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));

  const pulled = await request<GbncPullResponse>(`/api/data/gbnc/pull?${params.toString()}`, { method: "POST" });
  const seriesId = Number(pulled.series_id || 0) || Number((pulled.series_ids || [])[0] || 0) || 0;
  let basisYear: number | null = null;
  let correctFirstYear: number | null = null;

  if (seriesId) {
    const meta = await request<GbncSeriesMetaResponse>(`/api/data/gbnc/series/${seriesId}`);
    const targetVariants = Array.from(
      new Set(
        [word, ...(opts?.variants || []), ...(meta.variants || [])]
          .map((item) => String(item || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const pointGroups = await Promise.all(
      targetVariants.map(async (variant) => {
        try {
          return await request<GbncSeriesPointsResponse>(
            `/api/data/gbnc/series/${seriesId}/points?variant=${encodeURIComponent(variant)}`
          );
        } catch {
          return { series_id: seriesId, variant, items: [] };
        }
      })
    );

    const totalByYear = new Map<number, number>();
    for (const group of pointGroups) {
      for (const item of group.items || []) {
        const year = extractObservedYear(item.time);
        const value = Number(item.value || 0);
        if (year === null || !Number.isFinite(value) || value <= 0) continue;
        totalByYear.set(year, (totalByYear.get(year) || 0) + value);
        if (String(group.variant || "").trim().toLowerCase() === String(word || "").trim().toLowerCase() && correctFirstYear === null) {
          correctFirstYear = year;
        }
      }
    }

    basisYear =
      Array.from(totalByYear.entries())
        .filter(([, value]) => value > 0)
        .sort((a, b) => a[0] - b[0])[0]?.[0] ?? null;
  }

  const suggestedYear =
    correctFirstYear ??
    basisYear ??
    (opts?.startYear !== undefined ? Number(opts.startYear) : null);

  const warnings = (pulled.warnings || []).filter((warning) => String(warning || "").trim() !== "origin_year_route_404_fallback");
  return {
    word: String(word || "").trim().toLowerCase(),
    variants: (opts?.variants || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean),
    suggested_year: suggestedYear,
    basis_year: basisYear,
    correct_first_year: correctFirstYear,
    source: String(pulled.source || "").toUpperCase() === "GBNC" ? "gbnc" : "heuristic",
    dataset_source: pulled.source,
    reasoning:
      "根据当前 GBNC 时序首现年份推断：优先采用 correct 序列首次出现年份，否则采用 total signal 序列首次出现年份。",
    warnings,
  };
}

export const api = {
  getHealth: () => request<HealthResponse>("/health"),
  getExtendedHealth: () => request<ExtendedHealthResponse>("/api/health/extended"),
  getCaptcha: () => request<CaptchaResponse>("/api/auth/captcha"),
  login: (username: string, password: string, turnstileToken?: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      headers: withTurnstileHeaders(turnstileToken, { "Content-Type": "application/json" }),
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
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    }),
  createWordAnalysis: (
    word: string,
    opts?: { startYear?: number; endYear?: number; smoothing?: number; corpus?: string; variants?: string[] },
    turnstileToken?: string
  ) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    return request<CreateTaskResponse>(`/api/tasks/word-analysis?${params.toString()}`, {
      method: "POST",
      headers: withTurnstileHeaders(turnstileToken || "")
    });
  },
  createPcmciCausal: (
    word: string,
    opts?: AlgorithmTaskOptions & {
      tauMax?: number;
      windowSize?: number;
      windowStep?: number;
      alphaLevel?: number;
      pcAlpha?: number;
    },
    turnstileToken?: string
  ) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    if (opts?.tauMax !== undefined) params.set("tau_max", String(opts.tauMax));
    if (opts?.windowSize !== undefined) params.set("window_size", String(opts.windowSize));
    if (opts?.windowStep !== undefined) params.set("window_step", String(opts.windowStep));
    if (opts?.alphaLevel !== undefined) params.set("alpha_level", String(opts.alphaLevel));
    if (opts?.pcAlpha !== undefined) params.set("pc_alpha", String(opts.pcAlpha));
    return request<CreateTaskResponse>(`/api/tasks/pcmci-causal?${params.toString()}`, {
      method: "POST",
      headers: withTurnstileHeaders(turnstileToken || "")
    });
  },
  createMrnmrSteady: (
    word: string,
    opts?: AlgorithmTaskOptions & { tippingIndex?: number; kdeBandwidth?: string; polyDegree?: number },
    turnstileToken?: string
  ) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    if (opts?.originYear !== undefined) params.set("origin_year", String(opts.originYear));
    if (opts?.tippingIndex !== undefined) params.set("tipping_index", String(opts.tippingIndex));
    if (opts?.kdeBandwidth) params.set("kde_bandwidth", opts.kdeBandwidth);
    if (opts?.polyDegree !== undefined) params.set("poly_degree", String(opts.polyDegree));
    return request<CreateTaskResponse>(`/api/tasks/mrnmr-steady?${params.toString()}`, {
      method: "POST",
      headers: withTurnstileHeaders(turnstileToken || "")
    });
  },
  createDeltaTNull: (
    word: string,
    opts?: AlgorithmTaskOptions & {
      bootstrapSamples?: number;
      eventThresholdQuantile?: number;
      randomSeed?: number;
    },
    turnstileToken?: string
  ) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    if (opts?.originYear !== undefined) params.set("origin_year", String(opts.originYear));
    if (opts?.bootstrapSamples !== undefined) params.set("bootstrap_samples", String(opts.bootstrapSamples));
    if (opts?.eventThresholdQuantile !== undefined) {
      params.set("event_threshold_quantile", String(opts.eventThresholdQuantile));
    }
    if (opts?.randomSeed !== undefined) params.set("random_seed", String(opts.randomSeed));
    return request<CreateTaskResponse>(`/api/tasks/deltaT-null?${params.toString()}`, {
      method: "POST",
      headers: withTurnstileHeaders(turnstileToken || "")
    });
  },
  createSimulation: (word: string, opts?: SimulationTaskOptions, turnstileToken?: string) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.startYear) params.set("start_year", String(opts.startYear));
    if (opts?.endYear) params.set("end_year", String(opts.endYear));
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    if (opts?.topology) params.set("topology", String(opts.topology));
    if (opts?.nAgents !== undefined) params.set("n_agents", String(opts.nAgents));
    if (opts?.searchRounds !== undefined) params.set("search_rounds", String(opts.searchRounds));
    if (opts?.repeats !== undefined) params.set("repeats", String(opts.repeats));
    if (opts?.fitProfile) params.set("fit_profile", String(opts.fitProfile));
    if (opts?.trendWindow !== undefined) params.set("trend_window", String(opts.trendWindow));
    if (opts?.wsK !== undefined) params.set("ws_k", String(opts.wsK));
    if (opts?.wsP !== undefined) params.set("ws_p", String(opts.wsP));
    if (opts?.baM !== undefined) params.set("ba_m", String(opts.baM));
    if (opts?.randomSeed !== undefined) params.set("random_seed", String(opts.randomSeed));
    if (opts?.interventionYear !== undefined) params.set("intervention_year", String(opts.interventionYear));
    return request<CreateTaskResponse>(`/api/tasks/simulation-run?${params.toString()}`, {
      method: "POST",
      headers: withTurnstileHeaders(turnstileToken || "")
    });
  },
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
  suggestVariants: (
    word: string,
    k = 12,
    opts?: {
      persist?: boolean;
      preferCache?: boolean;
    }
  ) => {
    const params = new URLSearchParams();
    params.set("word", word);
    params.set("k", String(k));
    if (opts?.persist !== undefined) params.set("persist", String(Boolean(opts.persist)));
    if (opts?.preferCache !== undefined) params.set("prefer_cache", String(Boolean(opts.preferCache)));
    return request<VariantSuggestResponse>(`/api/lexicon/variants/suggest?${params.toString()}`, { method: "POST" });
  },
  suggestOriginYear: async (
    word: string,
    opts?: { variants?: string[]; startYear?: number; endYear?: number; corpus?: string; smoothing?: number }
  ) => {
    const params = new URLSearchParams();
    params.set("word", word);
    if (opts?.variants && opts.variants.length > 0) params.set("variants", opts.variants.join(","));
    if (opts?.startYear !== undefined) params.set("start_year", String(opts.startYear));
    if (opts?.endYear !== undefined) params.set("end_year", String(opts.endYear));
    if (opts?.corpus) params.set("corpus", opts.corpus);
    if (opts?.smoothing !== undefined) params.set("smoothing", String(opts.smoothing));
    const query = params.toString();
    const candidates = [
      `/api/lexicon/origin-year/suggest?${query}`,
      `/api/lexicon/origin_year/suggest?${query}`,
    ];
    let lastError: unknown = null;
    for (const path of candidates) {
      try {
        return await request<OriginYearSuggestResponse>(path);
      } catch (error) {
        lastError = error;
      }
    }
    try {
      return await fallbackOriginYearSuggestion(word, opts);
    } catch (fallbackError) {
      throw lastError ?? fallbackError;
    }
  },
  listVariantCache: (word = "", limit = 200) =>
    request<VariantCacheListResponse>(
      `/api/lexicon/variant-cache?word=${encodeURIComponent(word)}&limit=${limit}`
    ),
  saveVariantCache: (word: string, variants: string[], source = "manual") =>
    request<{ saved: number }>("/api/lexicon/variant-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, variants, source })
    }),
  deleteVariantCache: (body: { ids?: number[]; word?: string; variants?: string[] }) =>
    request<{ deleted: number }>("/api/lexicon/variant-cache", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: body.ids || [],
        word: body.word || undefined,
        variants: body.variants || []
      })
    }),
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
    request<{ project_id: number; added: number; category?: string; cohort_id?: number | null }>(`/api/projects/${projectId}/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words, category })
    }),
  listProjectTerms: (projectId: number) => request<ProjectTermsResponse>(`/api/projects/${projectId}/terms`),
  listProjectCohorts: (projectId: number) => request<ProjectCohortsResponse>(`/api/projects/${projectId}/cohorts`),
  createProjectCohort: (
    projectId: number,
    body: { name: string; description?: string; color?: string; sort_order?: number }
  ) =>
    request<{ project_id: number; item: ProjectCohortItem }>(`/api/projects/${projectId}/cohorts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  updateProjectCohort: (
    projectId: number,
    cohortId: number,
    body: {
      name?: string;
      description?: string;
      color?: string;
      rule_json?: Record<string, unknown>;
      sort_order?: number;
      is_active?: boolean;
    }
  ) =>
    request<{ project_id: number; cohort_id: number; ok: boolean }>(
      `/api/projects/${projectId}/cohorts/${cohortId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    ),
  deleteProjectCohort: (projectId: number, cohortId: number) =>
    request<{ project_id: number; cohort_id: number; deleted: boolean }>(
      `/api/projects/${projectId}/cohorts/${cohortId}`,
      { method: "DELETE" }
    ),
  listProjectMemberships: (projectId: number) =>
    request<ProjectMembershipsResponse>(`/api/projects/${projectId}/memberships`),
  upsertProjectMemberships: (
    projectId: number,
    assignments: Array<{
      term_id?: number;
      word?: string;
      cohort_id?: number;
      cohort_name?: string;
      membership_weight?: number;
      confidence?: number;
      source?: string;
      note?: string;
    }>
  ) =>
    request<{ project_id: number; upserted: number }>(`/api/projects/${projectId}/memberships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments })
    }),
  deleteProjectMembership: (
    projectId: number,
    body: { membership_id?: number; term_id?: number; cohort_id?: number }
  ) =>
    request<{ project_id: number; deleted: number }>(`/api/projects/${projectId}/memberships`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  bindProjectTask: (projectId: number, taskId: string) =>
    request<{ ok: boolean; project_id: number; task_id: string }>(`/api/projects/${projectId}/tasks/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId })
    }),
  listProjectTasks: (projectId: number, limit = 100) => request<ProjectTasksResponse>(`/api/projects/${projectId}/tasks?limit=${limit}`),
  analyticsSummary: (projectId: number) =>
    request<AnalyticsSummaryResponse>(`/api/analytics/summary?project_id=${projectId}`),
  analyticsCluster: (projectId: number, k = 3, method: "kmeans_advanced" | "baseline-kmeans" = "kmeans_advanced") =>
    request<AnalyticsClusterResponse>("/api/analytics/cluster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, k, method })
    }),
  analyticsCohortCompare: (
    projectId: number,
    cohortA: string,
    cohortB: string,
    opts?: { permutations?: number; bootstrap?: number }
  ) =>
    request<AnalyticsCohortCompareResponse>("/api/analytics/cohort-compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        cohort_a: cohortA,
        cohort_b: cohortB,
        permutations: opts?.permutations,
        bootstrap: opts?.bootstrap
      })
    }),
  analyticsTemporalPatterns: (projectId: number, nClusters = 3, limitTerms = 160) =>
    request<AnalyticsTemporalPatternsResponse>("/api/analytics/temporal-patterns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        n_clusters: nClusters,
        limit_terms: limitTerms
      })
    }),
  analyticsExplainability: (projectId: number, targetCohort?: string) =>
    request<AnalyticsExplainabilityResponse>("/api/analytics/explainability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        target_cohort: targetCohort || undefined
      })
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
  adminVariantCache: (limit = 300, userId?: number, word?: string) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (userId && userId > 0) params.set("user_id", String(userId));
    if (word?.trim()) params.set("word", word.trim());
    return request<VariantCacheListResponse>(`/api/admin/variant-cache?${params.toString()}`);
  },
  adminDeleteVariantCache: (entryId: number) =>
    request<{ deleted: boolean }>(`/api/admin/variant-cache/${entryId}`, { method: "DELETE" }),
  adminSettings: () => request<AdminSettingsResponse>("/api/admin/settings"),
  adminDiagnostics: () => request<AdminDiagnosticsResponse>("/api/admin/diagnostics"),
  adminPurge: (scope: "guest" | "user", what: string[], userId?: number) =>
    request<{ ok: boolean; deleted: Record<string, number> }>("/api/admin/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, user_id: userId, what })
    }),
  fileUrl: (taskId: string, filename: string) => {
    const base = `/api/files/${encodeURIComponent(taskId)}/${encodeURIComponent(filename)}`;
    const params = new URLSearchParams();
    if (accessToken) {
      params.set("access_token", accessToken);
    } else {
      const fallbackGuestKey = resolveGuestKey();
      if (fallbackGuestKey) params.set("guest_key", fallbackGuestKey);
    }
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }
};

export function describeApiError(error: unknown) {
  const err = error as ApiError;
  if (err?.status === 404) return "404: resource not found or feature not enabled.";
  if (err?.status === 500) return "500: backend exception. Check docker compose logs api/worker.";
  if (err instanceof Error) return err.message;
  return "Request failed.";
}
