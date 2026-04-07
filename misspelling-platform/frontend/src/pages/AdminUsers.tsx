/* 文件说明：管理员用户页面，负责查看用户列表、角色与启用状态。 */

import { PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from "antd";
import { useEffect, useState } from "react";
import { api, describeApiError, type AdminUsersResponse } from "../lib/api";

export function AdminUsersPage() {
  const [items, setItems] = useState<AdminUsersResponse["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<{ username: string; password: string; role: "admin" | "user" }>();
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetForm] = Form.useForm<{ password: string; confirmPassword: string }>();

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
      message.success("用户已创建");
      setCreateOpen(false);
      createForm.resetFields();
      await refresh();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    }
  };

  return (
    <Card title="用户管理" extra={<Space><Button icon={<SyncOutlined />} onClick={() => void refresh()} loading={loading}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建用户</Button></Space>}>
      <Table
        rowKey="id"
        size="small"
        dataSource={items}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 70 },
          { title: "用户名", dataIndex: "username" },
          { title: "角色", dataIndex: "roles", render: (roles: string[]) => <>{roles.map((r) => <Tag key={r}>{r}</Tag>)}</> },
          {
            title: "启用",
            dataIndex: "is_active",
            render: (v: boolean, row: { id: number }) => (
              <Switch
                checked={v}
                onChange={async (checked) => {
                  try {
                    await api.adminUpdateUserActive(row.id, checked);
                    message.success("用户状态已更新");
                    await refresh();
                  } catch (e) {
                    message.error(describeApiError(e));
                  }
                }}
              />
            )
          },
          {
            title: "操作",
            render: (_: unknown, row: { id: number }) => (
              <Button
                size="small"
                onClick={() => {
                  setResetUserId(row.id);
                  setResetModalOpen(true);
                }}
              >
                重置密码
              </Button>
            )
          }
        ]}
      />

      <Modal title="新建用户" open={createOpen} onOk={() => void createUser()} onCancel={() => setCreateOpen(false)}>
        <Form layout="vertical" form={createForm} initialValues={{ role: "user" }}>
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password /></Form.Item>
          <Form.Item label="角色" name="role"><Select options={[{ value: "user", label: "user" }, { value: "admin", label: "admin" }]} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重置用户密码"
        open={resetModalOpen}
        onOk={async () => {
          try {
            const values = await resetForm.validateFields();
            if (resetUserId === null) return;
            await api.adminResetPassword(resetUserId, values.password);
            message.success("密码重置成功");
            setResetModalOpen(false);
            resetForm.resetFields();
            setResetUserId(null);
          } catch (e) {
            if (e instanceof Error) message.error(e.message);
          }
        }}
        onCancel={() => {
          setResetModalOpen(false);
          resetForm.resetFields();
          setResetUserId(null);
        }}
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            label="新密码"
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "密码至少 8 位" },
              {
                pattern: /^(?=.*[A-Za-z])(?=.*\d)/,
                message: "密码需同时包含字母和数字",
              },
            ]}
          >
            <Input.Password placeholder="输入新密码" />
          </Form.Item>
          <Form.Item
            label="确认密码"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: "请确认密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("两次输入密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
