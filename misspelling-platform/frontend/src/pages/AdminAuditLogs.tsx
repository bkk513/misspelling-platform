import { Button, Card, Drawer, Input, Space, Table, Tag } from "antd";
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
      // eslint-disable-next-line no-alert
      window.alert(describeApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => items.filter((x) => !query || x.action.includes(query) || String(x.target_id || "").includes(query)), [items, query]);

  return (
    <Card title="Audit Logs" extra={<Space><Input placeholder="Filter action/target" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220 }} /><Button onClick={() => void refresh()} loading={loading}>Refresh</Button></Space>}>
      <Table
        rowKey="id"
        size="small"
        dataSource={filtered}
        pagination={{ pageSize: 12 }}
        onRow={(r) => ({ onClick: () => setSelected(r) })}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "Action", dataIndex: "action", render: (v: string) => <Tag color="blue">{v}</Tag> },
          { title: "Target", render: (_: unknown, row: { target_type?: string; target_id?: string }) => `${row.target_type || "-"}:${row.target_id || "-"}` },
          { title: "Created", dataIndex: "created_at" }
        ]}
      />
      <Drawer title="Audit Detail" open={!!selected} onClose={() => setSelected(null)} width={520}>
        <pre className="pre-block">{JSON.stringify(selected, null, 2)}</pre>
      </Drawer>
    </Card>
  );
}
