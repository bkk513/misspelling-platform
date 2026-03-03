import { Alert, Button, Card, ConfigProvider } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../layouts/AdminLayout";
import { ResearcherLayout } from "../layouts/ResearcherLayout";
import { api, setAccessToken } from "../lib/api";
import { AdminDashboardPage } from "../pages/AdminDashboard";
import { AdminAuditLogsPage } from "../pages/AdminAuditLogs";
import { AdminDataSourcesPage } from "../pages/AdminDataSources";
import { AdminSettingsPage } from "../pages/AdminSettings";
import { AdminUsersPage } from "../pages/AdminUsers";
import { HomePage } from "../pages/Home";
import { LoginPage } from "../pages/Login";
import { PlaceholderPage } from "../pages/Placeholder";
import { ProjectManagerPage } from "../pages/ProjectManager";
import { CausalNetworkPage } from "../pages/CausalNetwork";
import { DeltaTBiasPage } from "../pages/DeltaTBias";
import { ReportCenterPage } from "../pages/ReportCenter";
import { ResearcherSettingsPage } from "../pages/ResearcherSettings";
import { SteadyStatePage } from "../pages/SteadyState";
import { TaskCenterPage } from "../pages/TaskCenter";
import { TaskDetailPage } from "../pages/TaskDetail";
import { TimeSeriesExplorerPage } from "../pages/TimeSeriesExplorer";
import { AnalyticsCenterPage } from "../pages/AnalyticsCenter";
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
  projects: "Project manager binds terms/tasks for meso-level analytics and report export.",
  analytics: "Baseline clustering and summary analytics are persisted to analytics_runs.",
  "causal-network": "Submit and inspect pcmci-causal tasks with top edge preview.",
  "steady-state": "Submit and inspect mrnmr-steady tasks with MR/NMR metrics preview.",
  "delta-t-bias": "Submit and inspect deltaT-null tasks with observed/null event summary.",
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
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [gbncEnabled, setGbncEnabled] = useState(false);

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
      .getExtendedHealth()
      .then((v) => {
        setDbOk(v.db);
        setLlmEnabled(v.llm_enabled);
        setGbncEnabled(v.gbnc_enabled);
      })
      .catch(async () => {
        try {
          const v = await api.getHealth();
          setDbOk(v.db);
        } catch {
          setDbOk(false);
        }
        setLlmEnabled(false);
        setGbncEnabled(false);
      });
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

  const onRegisterWithCaptcha = async (
    username: string,
    password: string,
    displayName?: string,
    email?: string,
    captchaId?: string,
    captchaCode?: string
  ) => {
    if (!username || !password) throw new Error("Username and password are required");
    if (!captchaId || !captchaCode) throw new Error("Captcha is required");
    const resp = await api.register(username, password, displayName, email, captchaId, captchaCode);
    const role: Session["role"] = resp.user.roles.includes("admin") ? "admin" : "user";
    setSession({ username: resp.user.username, role, token: resp.access_token });
    role === "admin" ? goToAdmin("dashboard") : goToApp("dashboard");
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
        <LoginPage
          onLogin={onLogin}
          onRegister={onRegisterWithCaptcha}
          onFetchCaptcha={api.getCaptcha}
          onGuest={onGuest}
        />
      </ConfigProvider>
    );
  }

  if (route.scope === "admin") {
    const adminRenderKey = `${session.role}:${session.username}:${session.token ? "auth" : "guest"}:admin:${route.key}`;
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
          {route.key === "audit-logs" && <AdminAuditLogsPage />}
          {route.key === "data-sources" && <AdminDataSourcesPage />}
          {route.key === "settings" && <AdminSettingsPage />}
          {route.key !== "dashboard" &&
            route.key !== "users" &&
            route.key !== "audit-logs" &&
            route.key !== "data-sources" &&
            route.key !== "settings" && (
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
          <div key={adminRenderKey}>{content}</div>
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
  if (route.key === "projects") content = <ProjectManagerPage />;
  if (route.key === "analytics") content = <AnalyticsCenterPage />;
  if (route.key === "causal-network") content = <CausalNetworkPage />;
  if (route.key === "steady-state") content = <SteadyStatePage />;
  if (route.key === "delta-t-bias") content = <DeltaTBiasPage />;
  if (route.key === "time-series") content = <TimeSeriesExplorerPage />;
  if (route.key === "artifacts") content = <ArtifactLibraryPage />;
  if (route.key === "reports") content = <ReportCenterPage />;
  if (route.key === "settings") content = <ResearcherSettingsPage />;

  const sessionRenderKey = `${session.role}:${session.username}:${session.token ? "auth" : "guest"}:${route.scope}:${route.key}:${route.scope === "app" && route.key === "task-detail" ? route.taskId || "" : ""}`;

  return (
    <ConfigProvider>
      <ResearcherLayout
        routeKey={route.key}
        breadcrumbs={breadcrumbs}
        dbOk={dbOk}
        llmEnabled={llmEnabled}
        gbncEnabled={gbncEnabled}
        username={session.username}
        role={session.role}
        onLogout={onLogout}
        onNavigate={(key) => goToApp(key as Exclude<AppRouteKey, "task-detail">)}
      >
        <div key={sessionRenderKey}>{content}</div>
      </ResearcherLayout>
    </ConfigProvider>
  );
}
