import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Space, Table, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type AdminSettingsResponse, type VariantCacheItem } from "../lib/api";

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeForm] = Form.useForm<{ user_id?: number }>();

  const [cacheRows, setCacheRows] = useState<VariantCacheItem[]>([]);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheUserId, setCacheUserId] = useState<number | undefined>(undefined);
  const [cacheWord, setCacheWord] = useState("");

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

  const refreshVariantCache = async () => {
    setCacheLoading(true);
    try {
      const resp = await api.adminVariantCache(400, cacheUserId, cacheWord || undefined);
      setCacheRows(resp.items || []);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setCacheLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void refreshVariantCache();
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
          管理员面板当前基于 `Bearer Token + admin role` 做权限控制，并提供用户、缓存、数据源与清理能力。建议在生产环境结合更细粒度 RBAC 策略使用。
        </Typography.Paragraph>
      </Card>

      <Card title="Variant Cache Management (Admin)">
        <Space wrap style={{ marginBottom: 12 }}>
          <InputNumber
            placeholder="User ID"
            min={1}
            value={cacheUserId}
            onChange={(v) => setCacheUserId(v || undefined)}
            style={{ width: 160 }}
          />
          <Input
            placeholder="Word"
            value={cacheWord}
            onChange={(e) => setCacheWord(e.target.value)}
            style={{ width: 200 }}
          />
          <Button onClick={() => void refreshVariantCache()} loading={cacheLoading}>Query</Button>
          <Button onClick={() => { setCacheUserId(undefined); setCacheWord(""); void refreshVariantCache(); }}>Clear</Button>
        </Space>

        <Table
          rowKey="id"
          size="small"
          loading={cacheLoading}
          dataSource={cacheRows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "User", render: (_: unknown, row: VariantCacheItem) => `${row.username || "-"} (#${row.owner_user_id || "-"})` },
            { title: "Word", dataIndex: "word" },
            { title: "Variant", dataIndex: "variant" },
            { title: "Source", dataIndex: "source" },
            { title: "Updated", dataIndex: "updated_at" },
            {
              title: "Action",
              render: (_: unknown, row: VariantCacheItem) => (
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    try {
                      const resp = await api.adminDeleteVariantCache(row.id);
                      if (resp.deleted) {
                        message.success("Deleted cache entry");
                        await refreshVariantCache();
                      }
                    } catch (e) {
                      message.error(describeApiError(e));
                    }
                  }}
                >
                  Delete
                </Button>
              )
            }
          ]}
        />
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
