import {
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  BulbOutlined,
  BulbFilled
} from "@ant-design/icons";
import { Alert, Badge, Breadcrumb, Button, Layout, Menu, Space, Tag, Typography, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { MenuProps } from "antd";
import { useTheme } from "../contexts/ThemeContext";

const { Header, Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  {
    key: 'admin-main',
    label: 'Administration',
    icon: <DashboardOutlined />,
    children: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'users', label: 'User Management' },
      { key: 'audit-logs', label: 'Audit Logs' },
    ],
  },
  {
    key: 'admin-system',
    label: 'System',
    icon: <SettingOutlined />,
    children: [
      { key: 'data-sources', label: 'Data Sources' },
      { key: 'settings', label: 'System Settings' },
    ],
  },
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
  const { theme, toggleTheme } = useTheme();

  return (
    <Layout className="enterprise-layout admin-layout">
      <Sider width={250} className="enterprise-sider" theme="dark">
        <div className="enterprise-logo admin-logo">Admin Console</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[routeKey]}
          defaultOpenKeys={['admin-main']}
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
            <Tooltip title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              <Button
                size="small"
                icon={theme === 'light' ? <BulbOutlined /> : <BulbFilled />}
                onClick={toggleTheme}
              >
                {theme === 'light' ? 'Dark' : 'Light'}
              </Button>
            </Tooltip>
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