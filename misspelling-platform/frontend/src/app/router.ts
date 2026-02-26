export type Route =
  | { name: "home" }
  | { name: "admin" }
  | { name: "task"; taskId: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "admin") {
    return { name: "admin" };
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

export function goHome() {
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
