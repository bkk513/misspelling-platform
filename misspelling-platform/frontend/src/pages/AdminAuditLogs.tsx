/* 文件说明：管理员审计日志页面，负责查看系统操作记录与关键事件。 */

import { Button, Card, Drawer, Input, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api, describeApiError, type AdminAuditResponse } from "../lib/api";

export function AdminAuditLogsPage() {
  const [items, setItems] = useState<AdminAuditResponse["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminAuditResponse["items"][number] | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.adminAuditLogs(200);
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

  const filtered = useMemo(() => items.filter((x) => !query || x.action.includes(query) || String(x.target_id || "").includes(query)), [items, query]);

  return (
    <Card title="审计日志" extra={<Space><Input placeholder="筛选动作/目标" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220 }} /><Button onClick={() => void refresh()} loading={loading}>刷新</Button></Space>}>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        审计日志用于追踪关键操作链路，点击任意行可查看完整明细。
      </Typography.Text>
      <Table
        rowKey="id"
        size="small"
        dataSource={filtered}
        pagination={{ pageSize: 12 }}
        onRow={(r) => ({ onClick: () => setSelected(r) })}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "动作", dataIndex: "action", render: (v: string) => <Tag color="blue">{v}</Tag> },
          { title: "目标", render: (_: unknown, row: { target_type?: string; target_id?: string }) => `${row.target_type || "-"}:${row.target_id || "-"}` },
          { title: "时间", dataIndex: "created_at" }
        ]}
      />
      <Drawer title="审计详情" open={!!selected} onClose={() => setSelected(null)} width={520}>
        <pre className="pre-block">{JSON.stringify(selected, null, 2)}</pre>
      </Drawer>
    </Card>
  );
}
