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
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title="Settings">
          <Alert
            type="info"
            showIcon
            message="Guest mode"
            description="Guest 不提供个人信息与密码管理功能。登录用户后可查看个人信息并重置密码。"
          />
        </Card>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Profile" extra={<Button onClick={() => void refreshMe()} loading={loading}>Refresh</Button>}>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Username">{me?.username || username}</Descriptions.Item>
          <Descriptions.Item label="User ID">{me?.id ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="Roles">{(me?.roles || [sessionRole]).join(", ")}</Descriptions.Item>
          <Descriptions.Item label="Active">{String(me?.is_active ?? true)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Reset Password">
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
              { pattern: /^(?=.*[A-Za-z])(?=.*\d)/, message: "Password must contain letters and numbers" }
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
                }
              })
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
    </Space>
  );
}
