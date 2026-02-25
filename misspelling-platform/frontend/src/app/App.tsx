import { useEffect, useState } from "react";
import { HomePage } from "../pages/Home";
import { TaskDetailPage } from "../pages/TaskDetail";
import { goHome, parseRoute, type Route } from "./router";

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="link-button" onClick={goHome}>
          Misspelling Behavior Analysis Platform
        </button>
        <div className="muted">Framework v1 Demo UI (M6)</div>
      </header>
      <main className="app-main">
        {route.name === "home" ? <HomePage /> : <TaskDetailPage taskId={route.taskId} />}
      </main>
    </div>
  );
}
