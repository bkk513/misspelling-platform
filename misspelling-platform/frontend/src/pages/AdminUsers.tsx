import { PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type AdminUsersResponse } from "../lib/api";

export function AdminUsersPage() {
  const [items, setItems] = useState<AdminUsersResponse["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<{ username: string; password: string; role: "admin" | "user" }>();

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.adminUsers(120);
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

  const createUser = async () => {
    try {
      const values = await createForm.validateFields();
      await api.adminCreateUser(values.username, values.password, values.role);
      message.success("User created");
      setCreateOpen(false);
      createForm.resetFields();
      await refresh();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  };

  return (
    <Card title="User Management" extra={<Space><Button icon={<SyncOutlined />} onClick={() => void refresh()} loading={loading}>Refresh</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Create User</Button></Space>}>
      <Table
        rowKey="id"
        size="small"
        dataSource={items}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 70 },
          { title: "Username", dataIndex: "username" },
          { title: "Roles", dataIndex: "roles", render: (roles: string[]) => <>{roles.map((r) => <Tag key={r}>{r}</Tag>)}</> },
          {
            title: "Active",
            dataIndex: "is_active",
            render: (v: boolean, row: { id: number }) => (
              <Switch
                checked={v}
                onChange={async (checked) => {
                  try {
                    await api.adminUpdateUserActive(row.id, checked);
                    message.success("User status updated");
                    await refresh();
                  } catch (e) {
                    message.error(describeApiError(e));
                  }
                }}
              />
            )
          },
          {
            title: "Action",
            render: (_: unknown, row: { id: number }) => (
              <Button
                size="small"
                onClick={async () => {
                  const password = window.prompt("New password:") || "";
                  if (!password) return;
                  try {
                    await api.adminResetPassword(row.id, password);
                    message.success("Password reset successful");
                  } catch (e) {
                    message.error(describeApiError(e));
                  }
                }}
              >
                Reset Password
              </Button>
            )
          }
        ]}
      />

      <Modal title="Create User" open={createOpen} onOk={() => void createUser()} onCancel={() => setCreateOpen(false)}>
        <Form layout="vertical" form={createForm} initialValues={{ role: "user" }}>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item label="Role" name="role"><Select options={[{ value: "user", label: "user" }, { value: "admin", label: "admin" }]} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
