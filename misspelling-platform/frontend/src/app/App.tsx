/* 文件说明：前端应用根组件，负责会话恢复、路由分发、布局切换与全局错误兜底。 */

import { Alert, Button, Card, ConfigProvider } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../layouts/AdminLayout";
import { ResearcherLayout } from "../layouts/ResearcherLayout";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { api, setAccessToken, setGuestKey } from "../lib/api";
import { AdminDashboardPage } from "../pages/AdminDashboard";
import { AdminAuditLogsPage } from "../pages/AdminAuditLogs";
import { AdminDataSourcesPage } from "../pages/AdminDataSources";
import { AdminSettingsPage } from "../pages/AdminSettings";
import { AdminUsersPage } from "../pages/AdminUsers";
import { HomePage } from "../pages/Home";
import { LoginPage } from "../pages/Login";
import { PlaceholderPage } from "../pages/Placeholder";
import { CausalNetworkPage } from "../pages/CausalNetwork";
import { DeltaTBiasPage } from "../pages/DeltaTBias";
import { ReportCenterPage } from "../pages/ReportCenter";
import { ResearcherSettingsPage } from "../pages/ResearcherSettings";
import { SteadyStatePage } from "../pages/SteadyState";
import { TaskCenterPage } from "../pages/TaskCenter";
import { TaskDetailPage } from "../pages/TaskDetail";
import { TimeSeriesExplorerPage } from "../pages/TimeSeriesExplorer";
import { VariantStudioPage } from "../pages/VariantStudio";
import { WordAnalysisWorkbenchPage } from "../pages/WordAnalysisWorkbench";
import { ArtifactLibraryPage } from "../pages/ArtifactLibrary";
import { SimulationRunPage } from "../pages/SimulationRun";
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
const GUEST_KEY = "mp-guest-key";

function ensureGuestKey() {
  // 访客侧所有任务、缓存和时序查询都靠这个 guest key 做隔离。
  const existing = (window.localStorage.getItem(GUEST_KEY) || "").trim();
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `guest-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  window.localStorage.setItem(GUEST_KEY, generated);
  return generated;
}

const researcherNotes: Record<string, string> = {
  // 这里是页面说明文案映射，切换路由时顶部提示会直接读取这个表。
  "word-analysis": "词分析页面：配置参数、管理变体并提交任务。",
  variants: "变体管理页面：维护词项及其变体。",
  simulation: "传播仿真任务页面。",
  "causal-network": "PCMCI 因果网络任务页面。",
  "steady-state": "MRNMR 稳态分析任务页面。",
  "delta-t-bias": "DeltaT 偏差任务页面。",
  "time-series": "时序数据查询页面。",
  artifacts: "任务产物查看与下载页面。",
  reports: "报告导出页面。",
  settings: "用户设置页面。"
};

const adminNotes: Record<AdminRouteKey, string> = {
  dashboard: "系统概览。",
  users: "用户管理。",
  "audit-logs": "审计日志。",
  "data-sources": "数据源配置。",
  settings: "系统设置。"
};

function loadSession(): Session {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) {
      ensureGuestKey();
      return { username: "guest", role: "guest", token: "" };
    }
    const data = JSON.parse(raw) as Session;
    if (["guest", "user", "admin"].includes(data.role) && data.username) {
      if (data.role === "guest") ensureGuestKey();
      return data;
    }
  } catch {
    // ignore invalid local state
  }
  ensureGuestKey();
  return { username: "guest", role: "guest", token: "" };
}

export function App() {
  // App 组件负责把“当前路由 + 当前会话 + 后端健康状态”三件事统一管理起来。
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
    // 会话变化后同步更新 localStorage 和请求头，让页面刷新后仍能保持登录态或访客态。
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setAccessToken(session.token || "");
    if (session.role === "guest") {
      setGuestKey(ensureGuestKey());
    } else {
      setGuestKey("");
    }
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

  const onLogin = async (username: string, password: string, turnstileToken?: string) => {
    if (!username || !password) throw new Error("用户名和密码不能为空");
    const resp = await api.login(username, password, turnstileToken);
    const role: Session["role"] = resp.user.roles.includes("admin") ? "admin" : "user";
    setAccessToken(resp.access_token);
    setGuestKey("");
    setSession({ username: resp.user.username, role, token: resp.access_token });
    role === "admin" ? goToAdmin("dashboard") : goToApp("dashboard");
  };

  const onGuest = () => {
    setSession({ username: "guest", role: "guest", token: "" });
    goToApp("dashboard");
  };

  const onRegister = async (username: string, password: string, displayName?: string, email?: string) => {
    if (!username || !password) throw new Error("用户名和密码不能为空");
    const resp = await api.register(username, password, displayName, email);
    const role: Session["role"] = resp.user.roles.includes("admin") ? "admin" : "user";
    setAccessToken(resp.access_token);
    setGuestKey("");
    setSession({ username: resp.user.username, role, token: resp.access_token });
    role === "admin" ? goToAdmin("dashboard") : goToApp("dashboard");
  };

  const onLogout = () => {
    setSession({ username: "guest", role: "guest", token: "" });
    goToLogin();
  };

  const breadcrumbs = useMemo(() => {
    if (route.scope === "app") {
      return ["研究工作台", route.key === "task-detail" ? `任务 ${route.taskId || "-"}` : route.key];
    }
    if (route.scope === "admin") return ["管理后台", route.key];
    return [route.scope];
  }, [route]);

  if (route.scope === "login") {
    return (
      <ConfigProvider>
        <LoginPage
          onLogin={onLogin}
          onRegister={onRegister}
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
            message="401 无权限"
            description="管理员路由仅允许管理员登录后访问。"
            action={<Button onClick={goToLogin}>前往登录</Button>}
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
              title={route.key === "dashboard" ? "管理仪表盘" : route.key}
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
          <ErrorBoundary key={adminRenderKey}>
            <div key={adminRenderKey}>{content}</div>
          </ErrorBoundary>
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
            message="404 路由不存在"
            action={<Button onClick={goHome}>返回仪表盘</Button>}
          />
        </Card>
      </ConfigProvider>
    );
  }

  let content = <PlaceholderPage title={route.key} description={researcherNotes[route.key] ?? "模块已就绪"} />;
  if (route.key === "dashboard") content = <HomePage />;
  if (route.key === "tasks") content = <TaskCenterPage />;
  if (route.key === "task-detail" && route.taskId) content = <TaskDetailPage taskId={route.taskId} />;
  if (route.key === "word-analysis") content = <WordAnalysisWorkbenchPage />;
  if (route.key === "variants") content = <VariantStudioPage />;
  if (route.key === "simulation") content = <SimulationRunPage />;
  if (route.key === "causal-network") content = <CausalNetworkPage />;
  if (route.key === "steady-state") content = <SteadyStatePage />;
  if (route.key === "delta-t-bias") content = <DeltaTBiasPage />;
  if (route.key === "time-series") content = <TimeSeriesExplorerPage />;
  if (route.key === "artifacts") content = <ArtifactLibraryPage />;
  if (route.key === "reports") content = <ReportCenterPage sessionRole={session.role} />;
  if (route.key === "settings") content = <ResearcherSettingsPage sessionRole={session.role} username={session.username} />;

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
        <ErrorBoundary key={sessionRenderKey}>
          <div key={sessionRenderKey}>{content}</div>
        </ErrorBoundary>
      </ResearcherLayout>
    </ConfigProvider>
  );
}
