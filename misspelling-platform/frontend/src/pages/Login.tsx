import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { useTheme } from "../contexts/ThemeContext";
import type { CaptchaResponse } from "../lib/api";

export function LoginPage({
  onLogin,
  onRegister,
  onFetchCaptcha,
  onGuest
}: {
  onLogin: (username: string, password: string, turnstileToken?: string) => Promise<void>;
  onRegister: (
    username: string,
    password: string,
    displayName?: string,
    email?: string,
    captchaId?: string,
    captchaCode?: string
  ) => Promise<void>;
  onFetchCaptcha: () => Promise<CaptchaResponse>;
  onGuest: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [captcha, setCaptcha] = useState<CaptchaResponse | null>(null);
  const [loginTurnstileToken, setLoginTurnstileToken] = useState("");
  const [loginTurnstileNonce, setLoginTurnstileNonce] = useState(0);
  const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
  const turnstileEnabled = !!turnstileSiteKey;
  const { theme } = useTheme();

  useEffect(() => {
    if (mode !== "register") return;
    void onFetchCaptcha()
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  }, [mode, onFetchCaptcha]);

  const submit = async (values: { username: string; password: string }) => {
    if (turnstileEnabled && !loginTurnstileToken) {
      setErr("Please complete Turnstile verification.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onLogin(values.username, values.password, loginTurnstileToken);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
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
    captcha_code: string;
  }) => {
    setBusy(true);
    setErr("");
    try {
      await onRegister(
        values.username,
        values.password,
        values.display_name,
        values.email,
        captcha?.captcha_id,
        values.captcha_code
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Register failed");
      try {
        setCaptcha(await onFetchCaptcha());
      } catch {
        setCaptcha(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <Card className="login-card" title="Misspelling Platform Login">
        <Typography.Paragraph type="secondary">
          Admin routes require authenticated admin role. Guest mode remains available for demo compatibility.
        </Typography.Paragraph>
        {err && <Alert type="error" message={err} style={{ marginBottom: 12 }} />}
        <Tabs
          activeKey={mode}
          onChange={(k) => setMode(k as "login" | "register")}
          items={[
            {
              key: "login",
              label: "Login",
              children: (
                <Form layout="vertical" onFinish={submit} initialValues={{ username: "", password: "" }}>
                  <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                    <Input prefix={<UserOutlined />} placeholder="Enter username" autoComplete="username" />
                  </Form.Item>
                  <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="Enter password"
                      autoComplete="current-password"
                    />
                  </Form.Item>
                  <Form.Item label="Bot Protection" required={turnstileEnabled}>
                    <TurnstileWidget
                      siteKey={turnstileSiteKey}
                      refreshKey={loginTurnstileNonce}
                      onTokenChange={setLoginTurnstileToken}
                      theme={theme}
                    />
                  </Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={busy} disabled={turnstileEnabled && !loginTurnstileToken}>
                      Login
                    </Button>
                    <Button onClick={onGuest}>Continue as Guest</Button>
                  </Space>
                </Form>
              )
            },
            {
              key: "register",
              label: "Register",
              children: (
                <Form layout="vertical" onFinish={submitRegister}>
                  <Form.Item name="username" label="Username" rules={[{ required: true, min: 3 }]}>
                    <Input prefix={<UserOutlined />} placeholder="Choose username" autoComplete="username" />
                  </Form.Item>
                  <Form.Item name="display_name" label="Display Name (optional)">
                    <Input placeholder="Display name" autoComplete="name" />
                  </Form.Item>
                  <Form.Item name="email" label="Email (optional)">
                    <Input placeholder="Email" autoComplete="email" />
                  </Form.Item>
                  <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
                    <Input.Password
                      prefix={<LockOutlined />}
                      placeholder="At least 8 chars, with letters and numbers"
                      autoComplete="new-password"
                    />
                  </Form.Item>
                  <Form.Item label="Captcha (demo text)">
                    <Space>
                      <Input value={captcha?.captcha_text || "..."} disabled style={{ width: 160 }} />
                      <Button
                        onClick={() => void onFetchCaptcha().then(setCaptcha).catch(() => setCaptcha(null))}
                        disabled={busy}
                      >
                        Refresh
                      </Button>
                    </Space>
                  </Form.Item>
                  <Form.Item
                    name="captcha_code"
                    label="Captcha Code"
                    rules={[{ required: true, message: "captcha code is required" }]}
                  >
                    <Input placeholder="Enter captcha text shown above" />
                  </Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={busy}>
                      Register
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
