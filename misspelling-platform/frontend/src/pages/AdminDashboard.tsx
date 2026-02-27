import { Button, Card, Col, Row, Space, Statistic, Table, Tag, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError } from "../lib/api";

export function AdminDashboardPage() {
  const [users, setUsers] = useState(0);
  const [logs, setLogs] = useState<Array<{ id: number; action: string; created_at?: string }>>([]);
  const [sources, setSources] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [u, a, d] = await Promise.all([api.adminUsers(10), api.adminAuditLogs(20), api.adminDataSources(20)]);
      setUsers(u.items.length);
      setLogs(a.items.map((x) => ({ id: x.id, action: x.action, created_at: x.created_at })));
      setSources(d.items.length);
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
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col xs={24} md={8}><Card><Statistic title="User Accounts" value={users} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="Audit Events (recent)" value={logs.length} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="Data Sources" value={sources} /></Card></Col>
      </Row>
      <Card title="Recent Audit Events" extra={<Button onClick={() => void refresh()} loading={loading}>Refresh</Button>}>
        <Table
          size="small"
          rowKey="id"
          dataSource={logs}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "Action", dataIndex: "action", render: (v: string) => <Tag color="blue">{v}</Tag> },
            { title: "Created", dataIndex: "created_at" }
          ]}
        />
      </Card>
    </Space>
  );
}
