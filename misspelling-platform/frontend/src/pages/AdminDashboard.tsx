/* 文件说明：管理员总览页面，负责展示系统运行状态与核心指标。 */

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
        <Col xs={24} md={8}><Card><Statistic title="用户数" value={users} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="近期审计事件" value={logs.length} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="数据源数" value={sources} /></Card></Col>
      </Row>
      <Card title="近期审计事件" extra={<Button onClick={() => void refresh()} loading={loading}>刷新</Button>}>
        <Table
          size="small"
          rowKey="id"
          dataSource={logs}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "动作", dataIndex: "action", render: (v: string) => <Tag color="blue">{v}</Tag> },
            { title: "时间", dataIndex: "created_at" }
          ]}
        />
      </Card>
    </Space>
  );
}
