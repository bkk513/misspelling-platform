/* 文件说明：管理员数据源页面，负责查看和管理平台接入的数据源状态。 */

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
      title="数据源"
      extra={<Button onClick={() => void refresh()} loading={loading}>刷新</Button>}
    >
      <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 12 }}>
        <Typography.Text type="secondary">
          管理系统可用的数据源状态。`ENABLED` 表示该源可用于任务调度。
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={items}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "名称", dataIndex: "name" },
          { title: "状态", dataIndex: "is_enabled", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "ENABLED" : "DISABLED"}</Tag> },
          { title: "粒度", dataIndex: "default_granularity" },
          { title: "最近同步", dataIndex: "last_sync_at" },
          { title: "更新时间", dataIndex: "updated_at" }
        ]}
      />
    </Card>
  );
}
