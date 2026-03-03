import { Button, Card, Descriptions, Form, InputNumber, Modal, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type AdminSettingsResponse } from "../lib/api";

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeForm] = Form.useForm<{ user_id?: number }>();

  const refresh = async () => {
    setLoading(true);
    try {
      setSettings(await api.adminSettings());
      setError("");
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="System Settings" extra={<Button onClick={() => void refresh()} loading={loading}>Refresh</Button>}>
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
        {settings && (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="allow_guest">{String(settings.allow_guest)}</Descriptions.Item>
            <Descriptions.Item label="llm_enabled">{String(settings.llm_enabled)}</Descriptions.Item>
            <Descriptions.Item label="gbnc_enabled">{String(settings.gbnc_enabled)}</Descriptions.Item>
            <Descriptions.Item label="admin_token_compat">{String(settings.admin_token_compat)}</Descriptions.Item>
          </Descriptions>
        )}
      </Card>
      <Card title="Policy Note">
        <Typography.Paragraph type="secondary">
          当前为演示阶段：管理员面板依赖 Bearer + admin role；后续将增加更细粒度 RBAC 权限点控制。
        </Typography.Paragraph>
      </Card>
      <Card title="Data Purge (Admin)">
        <Space wrap>
          <Button
            danger
            onClick={async () => {
              try {
                const resp = await api.adminPurge("guest", ["tasks", "series", "artifacts", "lexicon"]);
                message.success(`Guest purge completed: ${JSON.stringify(resp.deleted)}`);
              } catch (e) {
                message.error(describeApiError(e));
              }
            }}
          >
            Purge Guest Data
          </Button>
          <Button onClick={() => setPurgeOpen(true)}>Purge Specific User</Button>
        </Space>
      </Card>
      <Modal
        title="Purge User Data"
        open={purgeOpen}
        onCancel={() => setPurgeOpen(false)}
        onOk={async () => {
          try {
            const values = await purgeForm.validateFields();
            const resp = await api.adminPurge("user", ["tasks", "series", "artifacts", "lexicon"], values.user_id);
            message.success(`User purge completed: ${JSON.stringify(resp.deleted)}`);
            setPurgeOpen(false);
            purgeForm.resetFields();
          } catch (e) {
            message.error(describeApiError(e));
          }
        }}
      >
        <Form form={purgeForm} layout="vertical">
          <Form.Item name="user_id" label="User ID" rules={[{ required: true, type: "number", min: 1 }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
