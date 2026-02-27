import { Alert, Button, Card, ConfigProvider } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../layouts/AdminLayout";
import { ResearcherLayout } from "../layouts/ResearcherLayout";
import { api, setAccessToken } from "../lib/api";
import { AdminDashboardPage } from "../pages/AdminDashboard";
import { AdminUsersPage } from "../pages/AdminUsers";
import { HomePage } from "../pages/Home";
import { LoginPage } from "../pages/Login";
import { PlaceholderPage } from "../pages/Placeholder";
import { TaskCenterPage } from "../pages/TaskCenter";
import { TaskDetailPage } from "../pages/TaskDetail";
import { TimeSeriesExplorerPage } from "../pages/TimeSeriesExplorer";
import { VariantStudioPage } from "../pages/VariantStudio";
import { WordAnalysisWorkbenchPage } from "../pages/WordAnalysisWorkbench";
import { ArtifactLibraryPage } from "../pages/ArtifactLibrary";
import {
  goHome,
  goToAdmin,
  goToApp,
  goToLogin,
  parseRoute,
  type AdminRouteKey,
  type AppRouteKey,
  type Route
} from "./router";

type Session = { username: string; role: "guest" | "user" | "admin"; token?: string };

const SESSION_KEY = "mp-session";

const researcherNotes: Record<string, string> = {
  "word-analysis": "GBNC parameter controls and variant selector will be implemented in Commit 3.",
  variants: "Variant cache and manual editing workflow will be implemented in Commit 3.",
  "time-series": "Series grid and chart interactions will be implemented in Commit 4.",
  artifacts: "Artifact list, preview and download shortcuts will be implemented in Commit 4.",
  reports: "Report draft flow will be implemented in Commit 6.",
  settings: "Guest mode policy and owner-binding roadmap will be documented here."
};

const adminNotes: Record<AdminRouteKey, string> = {
  dashboard: "System metrics and queue overview will be implemented in Commit 5.",
  users: "Enterprise user table and reset password modal will be implemented in Commit 5.",
  "audit-logs": "Paged audit log table with drawer detail will be implemented in Commit 5.",
  "data-sources": "GBNC/LLM data source operations will be implemented in Commit 5.",
  settings: "Readonly settings and feature flags shell will be implemented in Commit 6."
};

function loadSession(): Session {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return { username: "guest", role: "guest", token: "" };
    const data = JSON.parse(raw) as Session;
    if (["guest", "user", "admin"].includes(data.role) && data.username) return data;
  } catch {
    // ignore invalid local state
  }
  return { username: "guest", role: "guest", token: "" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [session, setSession] = useState<Session>(() => loadSession());
  const [dbOk, setDbOk] = useState(false);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    if (window.location.pathname === "/") goHome();
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setAccessToken(session.token || "");
  }, [session]);

  useEffect(() => {
    void api
      .getHealth()
      .then((v) => setDbOk(v.db))
      .catch(() => setDbOk(false));
  }, [route.scope]);

  const onLogin = async (username: string, password: string) => {
    if (!username || !password) throw new Error("Username and password are required");
    const resp = await api.login(username, password);
    const role: Session["role"] = resp.user.roles.includes("admin") ? "admin" : "user";
    setSession({ username: resp.user.username, role, token: resp.access_token });
    role === "admin" ? goToAdmin("dashboard") : goToApp("dashboard");
  };

  const onGuest = () => {
    setSession({ username: "guest", role: "guest", token: "" });
    goToApp("dashboard");
  };

  const onLogout = () => {
    setSession({ username: "guest", role: "guest", token: "" });
    goToLogin();
  };

  const breadcrumbs = useMemo(() => {
    if (route.scope === "app") {
      return ["Researcher", route.key === "task-detail" ? `Task ${route.taskId || "-"}` : route.key];
    }
    if (route.scope === "admin") return ["Admin", route.key];
    return [route.scope];
  }, [route]);

  if (route.scope === "login") {
    return (
      <ConfigProvider>
        <LoginPage onLogin={onLogin} onGuest={onGuest} />
      </ConfigProvider>
    );
  }

  if (route.scope === "admin") {
    const content =
      session.role !== "admin" ? (
        <Card>
          <Alert
            type="error"
            showIcon
            message="401 Unauthorized"
            description="Admin routes require admin login."
            action={<Button onClick={goToLogin}>Go Login</Button>}
          />
        </Card>
      ) : (
        <>
          {route.key === "dashboard" && <AdminDashboardPage />}
          {route.key === "users" && <AdminUsersPage />}
          {route.key !== "dashboard" && route.key !== "users" && (
            <PlaceholderPage
              title={route.key === "dashboard" ? "Admin Dashboard" : route.key}
              description={adminNotes[route.key]}
            />
          )}
        </>
      );

    return (
      <ConfigProvider>
        <AdminLayout
          routeKey={route.key}
          breadcrumbs={breadcrumbs}
          username={session.username}
          role={session.role}
          onLogout={onLogout}
          onNavigate={(key) => goToAdmin(key as AdminRouteKey)}
        >
          {content}
        </AdminLayout>
      </ConfigProvider>
    );
  }

  if (route.scope === "forbidden") {
    return (
      <ConfigProvider>
        <Card>
          <Alert
            type="error"
            showIcon
            message="404 route not found"
            action={<Button onClick={goHome}>Go Dashboard</Button>}
          />
        </Card>
      </ConfigProvider>
    );
  }

  let content = <PlaceholderPage title={route.key} description={researcherNotes[route.key] ?? "Module scaffolding ready."} />;
  if (route.key === "dashboard") content = <HomePage />;
  if (route.key === "tasks") content = <TaskCenterPage />;
  if (route.key === "task-detail" && route.taskId) content = <TaskDetailPage taskId={route.taskId} />;
  if (route.key === "word-analysis") content = <WordAnalysisWorkbenchPage />;
  if (route.key === "variants") content = <VariantStudioPage />;
  if (route.key === "time-series") content = <TimeSeriesExplorerPage />;
  if (route.key === "artifacts") content = <ArtifactLibraryPage />;

  return (
    <ConfigProvider>
      <ResearcherLayout
        routeKey={route.key}
        breadcrumbs={breadcrumbs}
        dbOk={dbOk}
        llmEnabled={Boolean((import.meta.env.VITE_LLM_ENABLED || "").trim())}
        gbncEnabled={Boolean((import.meta.env.VITE_GBNC_ENABLED || "").trim())}
        username={session.username}
        role={session.role}
        onLogout={onLogout}
        onNavigate={(key) => goToApp(key as Exclude<AppRouteKey, "task-detail">)}
      >
        {content}
      </ResearcherLayout>
    </ConfigProvider>
  );
}
