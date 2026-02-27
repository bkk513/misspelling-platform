export type AppRouteKey =
  | "dashboard"
  | "tasks"
  | "task-detail"
  | "word-analysis"
  | "variants"
  | "time-series"
  | "artifacts"
  | "reports"
  | "settings";

export type AdminRouteKey = "dashboard" | "users" | "audit-logs" | "data-sources" | "settings";

export type Route =
  | { scope: "login" }
  | { scope: "app"; key: AppRouteKey; taskId?: string }
  | { scope: "admin"; key: AdminRouteKey }
  | { scope: "forbidden" };

function decodePath(v: string | undefined) {
  return v ? decodeURIComponent(v) : "";
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { scope: "app", key: "dashboard" };
  }
  if (parts[0] === "login") {
    return { scope: "login" };
  }
  if (parts[0] === "tasks" && parts[1]) {
    return { scope: "app", key: "task-detail", taskId: decodePath(parts[1]) };
  }
  if (parts[0] === "app") {
    if (parts[1] === "tasks" && parts[2]) {
      return { scope: "app", key: "task-detail", taskId: decodePath(parts[2]) };
    }
    const key = (parts[1] || "dashboard") as AppRouteKey;
    const allowed: AppRouteKey[] = [
      "dashboard",
      "tasks",
      "word-analysis",
      "variants",
      "time-series",
      "artifacts",
      "reports",
      "settings"
    ];
    return { scope: "app", key: allowed.includes(key) ? key : "dashboard" };
  }
  if (parts[0] === "admin") {
    const key = (parts[1] || "dashboard") as AdminRouteKey;
    const allowed: AdminRouteKey[] = ["dashboard", "users", "audit-logs", "data-sources", "settings"];
    return { scope: "admin", key: allowed.includes(key) ? key : "dashboard" };
  }
  return { scope: "forbidden" };
}

export function navigate(path: string, replace = false) {
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goToApp(key: Exclude<AppRouteKey, "task-detail">) {
  navigate(`/app/${key}`);
}

export function goToTask(taskId: string) {
  navigate(`/app/tasks/${encodeURIComponent(taskId)}`);
}

export function goToAdmin(key: AdminRouteKey) {
  navigate(`/admin/${key}`);
}

export function goToLogin() {
  navigate("/login");
}

export function goHome() {
  navigate("/app/dashboard");
}