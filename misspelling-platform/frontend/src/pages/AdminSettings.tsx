/* 文件说明：管理员设置页面，负责查看系统功能开关与诊断信息。 */

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
      <Card title="系统设置" extra={<Button onClick={() => void refresh()} loading={loading}>刷新</Button>}>
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
      <Card title="变体缓存管理（管理员）">
        <Space wrap style={{ marginBottom: 12 }}>
          <InputNumber
            placeholder="用户ID"
            min={1}
            value={cacheUserId}
            onChange={(v) => setCacheUserId(v || undefined)}
            style={{ width: 160 }}
          />
          <Input
            placeholder="词"
            value={cacheWord}
            onChange={(e) => setCacheWord(e.target.value)}
            style={{ width: 200 }}
          />
          <Button onClick={() => void refreshVariantCache()} loading={cacheLoading}>查询</Button>
          <Button onClick={() => { setCacheUserId(undefined); setCacheWord(""); void refreshVariantCache(); }}>清空</Button>
        </Space>

        <Table
          rowKey="id"
          size="small"
          loading={cacheLoading}
          dataSource={cacheRows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "用户", render: (_: unknown, row: VariantCacheItem) => `${row.username || "-"} (#${row.owner_user_id || "-"})` },
            { title: "词", dataIndex: "word" },
            { title: "变体", dataIndex: "variant" },
            { title: "来源", dataIndex: "source" },
            { title: "更新时间", dataIndex: "updated_at" },
            {
              title: "操作",
              render: (_: unknown, row: VariantCacheItem) => (
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    try {
                      const resp = await api.adminDeleteVariantCache(row.id);
                      if (resp.deleted) {
                        message.success("已删除缓存");
                        await refreshVariantCache();
                      }
                    } catch (e) {
                      message.error(describeApiError(e));
                    }
                  }}
                >
                  删除
                </Button>
              )
            }
          ]}
        />
      </Card>

      <Card title="数据清理（管理员）">
        <Space wrap>
          <Button
            danger
            onClick={async () => {
              try {
                const resp = await api.adminPurge("guest", ["tasks", "series", "artifacts", "lexicon"]);
                message.success(`访客数据清理完成：${JSON.stringify(resp.deleted)}`);
              } catch (e) {
                message.error(describeApiError(e));
              }
            }}
          >
            清理访客数据
          </Button>
          <Button onClick={() => setPurgeOpen(true)}>清理指定用户</Button>
        </Space>
      </Card>
      <Modal
        title="清理用户数据"
        open={purgeOpen}
        onCancel={() => setPurgeOpen(false)}
        onOk={async () => {
          try {
            const values = await purgeForm.validateFields();
            const resp = await api.adminPurge("user", ["tasks", "series", "artifacts", "lexicon"], values.user_id);
            message.success(`用户数据清理完成：${JSON.stringify(resp.deleted)}`);
            setPurgeOpen(false);
            purgeForm.resetFields();
          } catch (e) {
            message.error(describeApiError(e));
          }
        }}
      >
        <Form form={purgeForm} layout="vertical">
          <Form.Item name="user_id" label="用户ID" rules={[{ required: true, type: "number", min: 1 }]}>
            <InputNumber style={{ width: "100%" }} min={1} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
