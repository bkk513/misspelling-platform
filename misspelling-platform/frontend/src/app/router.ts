export type Route =
  | { name: "home" }
  | { name: "admin" }
  | { name: "series"; seriesId: number }
  | { name: "task"; taskId: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "admin") {
    return { name: "admin" };
  }
  if (parts[0] === "series" && parts[1]) {
    return { name: "series", seriesId: Number(parts[1]) || 0 };
  }
  if (parts[0] === "tasks" && parts[1]) {
    return { name: "task", taskId: decodeURIComponent(parts[1]) };
  }
  return { name: "home" };
}

export function goToTask(taskId: string) {
  window.history.pushState({}, "", `/tasks/${encodeURIComponent(taskId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goAdmin() {
  window.history.pushState({}, "", "/admin");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goToSeries(seriesId: number) {
  window.history.pushState({}, "", `/series/${encodeURIComponent(String(seriesId))}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goHome() {
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
