import { useEffect, useState } from "react";
import { AdminPage } from "../pages/Admin";
import { HomePage } from "../pages/Home";
import { TaskDetailPage } from "../pages/TaskDetail";
import { goAdmin, goHome, parseRoute, type Route } from "./router";

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
        <div className="row-inline" style={{ marginBottom: 0 }}>
          <button className="soft-nav" onClick={goHome}>Home</button>
          <button className="soft-nav" onClick={goAdmin}>Admin</button>
          <div className="muted">Framework v1 Demo UI (M7)</div>
        </div>
      </header>
      <main className="app-main">
        {route.name === "home" && <HomePage />}
        {route.name === "admin" && <AdminPage />}
        {route.name === "task" && <TaskDetailPage taskId={route.taskId} />}
      </main>
    </div>
  );
}
