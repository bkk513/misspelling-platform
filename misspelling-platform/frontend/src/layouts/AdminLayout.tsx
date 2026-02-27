import {
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { Alert, Badge, Breadcrumb, Button, Layout, Menu, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: "dashboard", label: "Admin Dashboard", icon: <DashboardOutlined /> },
  { key: "users", label: "User Management", icon: <TeamOutlined /> },
  { key: "audit-logs", label: "Audit Logs", icon: <AuditOutlined /> },
  { key: "data-sources", label: "Data Sources", icon: <DatabaseOutlined /> },
  { key: "settings", label: "System Settings", icon: <SettingOutlined /> }
];

export function AdminLayout({
  routeKey,
  breadcrumbs,
  username,
  role,
  onLogout,
  onNavigate,
  children
}: {
  routeKey: string;
  breadcrumbs: string[];
  username: string;
  role: string;
  onLogout: () => void;
  onNavigate: (key: string) => void;
  children: ReactNode;
}) {
  return (
    <Layout className="enterprise-layout admin-layout">
      <Sider width={250} className="enterprise-sider" theme="dark">
        <div className="enterprise-logo admin-logo">Admin Console</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[routeKey]}
          items={menuItems}
          onClick={({ key }) => onNavigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="enterprise-header">
          <Space size="middle">
            <Tag color="volcano" icon={<SafetyCertificateOutlined />}>
              Privileged Zone
            </Tag>
            <Alert
              type="warning"
              showIcon
              banner
              message="Admin operations are audited. Use production credentials only in secure environments."
            />
          </Space>
          <Space size="middle">
            <Badge status="processing" text={`role:${role}`} />
            <Typography.Text>{username}</Typography.Text>
            <Button size="small" onClick={onLogout}>
              Logout
            </Button>
          </Space>
        </Header>
        <Content className="enterprise-content">
          <Breadcrumb items={breadcrumbs.map((b) => ({ title: b }))} />
          <div className="enterprise-content-body">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}