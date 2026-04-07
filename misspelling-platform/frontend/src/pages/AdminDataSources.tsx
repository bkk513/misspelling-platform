import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type AdminDataSourcesResponse } from "../lib/api";

export function AdminDataSourcesPage() {
  const [items, setItems] = useState<AdminDataSourcesResponse["items"]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.adminDataSources(100);
      setItems(data.items);
    } catch (e) {
      message.error(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Card
      title="Data Sources"
      extra={<Button onClick={() => void refresh()} loading={loading}>Refresh</Button>}
    >
      <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 12 }}>
        <Typography.Text type="secondary">
          管理系统可用的数据源状态。`ENABLED` 表示 API 侧已经可被任务调度。
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={items}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "Name", dataIndex: "name" },
          { title: "Enabled", dataIndex: "is_enabled", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "ENABLED" : "DISABLED"}</Tag> },
          { title: "Granularity", dataIndex: "default_granularity" },
          { title: "Last Sync", dataIndex: "last_sync_at" },
          { title: "Updated", dataIndex: "updated_at" }
        ]}
      />
    </Card>
  );
}
