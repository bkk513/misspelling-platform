import { useEffect, useState } from "react";
import { AdminPage } from "../pages/Admin";
import { HomePage } from "../pages/Home";
import { TaskDetailPage } from "../pages/TaskDetail";
import { goAdmin, goHome, parseRoute, type Route } from "./router";

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const isAdmin = route.name === "admin";

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className={`app-shell${isAdmin ? " admin-shell" : ""}`}>
      <header className={`app-header${isAdmin ? " admin-header" : ""}`}>
        <button className="link-button" onClick={goHome}>
          {isAdmin ? "Admin Console" : "Misspelling Behavior Analysis Platform"}
        </button>
        <div className="row-inline" style={{ marginBottom: 0 }}>
          <button className="soft-nav" onClick={goHome}>Home</button>
          <button className="soft-nav" onClick={goAdmin}>Admin</button>
          <div className="muted">{isAdmin ? "Admin / Audit / Lexicon Curation" : "Researcher UI / Task Demo"}</div>
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
