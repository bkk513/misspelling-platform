import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useState } from "react";

export function LoginPage({
  onLogin,
  onGuest
}: {
  onLogin: (username: string, password: string) => Promise<void>;
  onGuest: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setErr("");
    try {
      await onLogin(values.username, values.password);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <Card className="login-card" title="Misspelling Platform Login">
        <Typography.Paragraph type="secondary">
          Admin routes require authenticated admin role. Guest mode is available only for researcher demo paths.
        </Typography.Paragraph>
        {err && <Alert type="error" message={err} style={{ marginBottom: 12 }} />}
        <Form layout="vertical" onFinish={submit} initialValues={{ username: "", password: "" }}>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder="Enter username" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Enter password" autoComplete="current-password" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={busy}>
              Login
            </Button>
            <Button onClick={onGuest}>Continue as Guest</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}