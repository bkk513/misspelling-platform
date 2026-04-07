/* 文件说明：登录注册页面组件，负责用户登录、注册与访客使用入口。 */

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Tabs, Typography } from "antd";
import { useState } from "react";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { useTheme } from "../contexts/ThemeContext";

export function LoginPage({
  onLogin,
  onRegister,
  onGuest
}: {
  onLogin: (username: string, password: string, turnstileToken?: string) => Promise<void>;
  onRegister: (username: string, password: string, displayName?: string, email?: string) => Promise<void>;
  onGuest: () => void;
}) {
  // 登录和注册共用同一张卡片，通过 Tabs 切换不同表单，降低入口复杂度。
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginTurnstileToken, setLoginTurnstileToken] = useState("");
  const [loginTurnstileNonce, setLoginTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;
  const { theme } = useTheme();

  const submit = async (values: { username: string; password: string }) => {
    // 如果开启了 Turnstile，登录前必须先拿到挑战 token。
    if (turnstileEnabled && !loginTurnstileToken) {
      setErr("请先完成 Turnstile 验证。");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onLogin(values.username, values.password, loginTurnstileToken);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
      setLoginTurnstileNonce((v) => v + 1);
    }
  };

  const submitRegister = async (values: {
    username: string;
    password: string;
    display_name?: string;
    email?: string;
  }) => {
    // 注册流程保持轻量，只收集老师验收时常见的用户名、密码和可选资料字段。
    setBusy(true);
    setErr("");
    try {
      await onRegister(values.username, values.password, values.display_name, values.email);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <Card className="login-card" title="错拼研究平台登录">
        <Typography.Paragraph type="secondary">
          管理员路由需要管理员身份。你也可以使用访客模式体验核心功能。
        </Typography.Paragraph>
        {err && <Alert type="error" message={err} style={{ marginBottom: 12 }} />}
        <Tabs
          activeKey={mode}
          onChange={(k) => setMode(k as "login" | "register")}
          items={[
            {
              key: "login",
              label: "登录",
              children: (
                <Form layout="vertical" onFinish={submit} initialValues={{ username: "", password: "" }}>
                  <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
                    <Input prefix={<UserOutlined />} placeholder="输入用户名" autoComplete="username" />
                  </Form.Item>
                  <Form.Item name="password" label="密码" rules={[{ required: true }]}>
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="输入密码"
                      autoComplete="current-password"
                    />
                  </Form.Item>
                  <Form.Item label="机器人校验" required={turnstileEnabled}>
                    <TurnstileWidget
                      siteKey={turnstileSiteKey}
                      refreshKey={loginTurnstileNonce}
                      onTokenChange={setLoginTurnstileToken}
                      theme={theme}
                    />
                  </Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={busy} disabled={turnstileEnabled && !loginTurnstileToken}>
                      登录
                    </Button>
                    <Button onClick={onGuest}>访客模式</Button>
                  </Space>
                </Form>
              )
            },
            {
              key: "register",
              label: "注册",
              children: (
                <Form layout="vertical" onFinish={submitRegister}>
                  <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}>
                    <Input prefix={<UserOutlined />} placeholder="设置用户名" autoComplete="username" />
                  </Form.Item>
                  <Form.Item name="display_name" label="显示名称（可选）">
                    <Input placeholder="显示名称" autoComplete="name" />
                  </Form.Item>
                  <Form.Item name="email" label="邮箱（可选）">
                    <Input placeholder="邮箱" autoComplete="email" />
                  </Form.Item>
                  <Form.Item name="password" label="密码" rules={[{ required: true, min: 8 }]}>
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="至少 8 位，建议包含字母和数字"
                      autoComplete="new-password"
                    />
                  </Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={busy}>
                      注册
                    </Button>
                  </Space>
                </Form>
              )
            }
          ]}
        />
      </Card>
    </div>
  );
}
