import { Alert, Button, Card, Descriptions, Form, Input, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type MeResponse } from "../lib/api";

export function ResearcherSettingsPage({
  sessionRole,
  username
}: {
  sessionRole: "guest" | "user" | "admin";
  username: string;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ oldPassword: string; newPassword: string; confirmPassword: string }>();

  const refreshMe = async () => {
    if (sessionRole === "guest") return;
    setLoading(true);
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshMe();
  }, [sessionRole]);

  if (sessionRole === "guest") {
    return (
      <div className="enterprise-page-shell">
        <Card bordered={false} className="enterprise-hero-card">
          <div className="enterprise-hero-grid">
            <div>
              <div className="enterprise-kicker">Researcher / Settings</div>
              <Typography.Title level={2} className="enterprise-hero-title">
                Guest Settings
              </Typography.Title>
              <Typography.Paragraph className="enterprise-hero-desc">
                Guest 会话不提供个人信息与密码管理能力。这里仅展示当前授权边界，避免误以为 guest 也拥有个人 cache、项目工作区和项目级分析能力。
              </Typography.Paragraph>
            </div>
          </div>
        </Card>
        <Card className="enterprise-section-card">
          <Alert
            type="info"
            showIcon
            message="Guest mode"
            description="Guest 不提供个人信息与密码管理功能；同时禁用项目工作区、cohort analytics、项目级报告和个人变体缓存。Guest 仍可使用词分析、算法运行、任务中心和自己会话内的任务详情。"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="enterprise-page-shell">
      <Card bordered={false} className="enterprise-hero-card">
        <div className="enterprise-hero-grid">
          <div>
            <div className="enterprise-kicker">Researcher / Settings</div>
            <Typography.Title level={2} className="enterprise-hero-title">
              Profile Settings
            </Typography.Title>
            <Typography.Paragraph className="enterprise-hero-desc">
              这里不改设置功能，只统一成同一套控制台视觉语言。账号信息与密码管理分开展示，减少原来页面的堆叠感。
            </Typography.Paragraph>
          </div>
          <div className="enterprise-hero-meta">
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Username</span>
              <div className="enterprise-meta-value" style={{ fontSize: 22 }}>{me?.username || username}</div>
              <div className="enterprise-meta-copy">当前登录身份。</div>
            </div>
            <div className="enterprise-meta-card">
              <span className="enterprise-meta-label">Roles</span>
              <div className="enterprise-meta-value" style={{ fontSize: 22 }}>{(me?.roles || [sessionRole]).join(", ")}</div>
              <div className="enterprise-meta-copy">角色决定可访问的研究能力范围。</div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        className="enterprise-section-card"
        title="Profile"
        extra={<Button onClick={() => void refreshMe()} loading={loading}>Refresh</Button>}
      >
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Username">{me?.username || username}</Descriptions.Item>
          <Descriptions.Item label="User ID">{me?.id ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="Roles">{(me?.roles || [sessionRole]).join(", ")}</Descriptions.Item>
          <Descriptions.Item label="Active">{String(me?.is_active ?? true)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card className="enterprise-section-card" title="Reset Password">
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            try {
              await api.changePassword(values.oldPassword, values.newPassword);
              message.success("Password updated successfully");
              form.resetFields();
            } catch (e) {
              message.error(describeApiError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item label="Current Password" name="oldPassword" rules={[{ required: true, message: "Please input current password" }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="New Password"
            name="newPassword"
            rules={[
              { required: true, message: "Please input new password" },
              { min: 8, message: "Password must be at least 8 characters" },
              { pattern: /^(?=.*[A-Za-z])(?=.*\d)/, message: "Password must contain letters and numbers" },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="Confirm New Password"
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "Please confirm password" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) return Promise.resolve();
                  return Promise.reject(new Error("Passwords do not match"));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>Update Password</Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Password policy: at least 8 characters, and include letters + digits.
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
