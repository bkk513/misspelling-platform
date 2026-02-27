import { Button, Card, Descriptions, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type AdminSettingsResponse } from "../lib/api";

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    </Space>
  );
}
