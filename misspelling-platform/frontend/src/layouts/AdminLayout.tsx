/* 文件说明：管理员布局组件，负责管理员端侧边栏、页头与内容区域的整体框架。 */

import {
  DashboardOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  BulbOutlined,
  BulbFilled
} from "@ant-design/icons";
import { Badge, Breadcrumb, Button, Layout, Menu, Space, Tag, Typography, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { MenuProps } from "antd";
import { useTheme } from "../contexts/ThemeContext";

const { Header, Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  {
    key: 'admin-main',
    label: '管理',
    icon: <DashboardOutlined />,
    children: [
      { key: 'dashboard', label: '总览' },
      { key: 'users', label: '用户管理' },
      { key: 'audit-logs', label: '审计日志' },
    ],
  },
  {
    key: 'admin-system',
    label: '系统',
    icon: <SettingOutlined />,
    children: [
      { key: 'data-sources', label: '数据源' },
      { key: 'settings', label: '系统设置' },
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
        <div className="enterprise-logo admin-logo">
          <div className="enterprise-logo-inner">
            <span>错拼研究平台</span>
            <small>管理员控制台</small>
          </div>
        </div>
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
          <div className="enterprise-header-left">
            <Space size={8} wrap>
              <Tag color="volcano" icon={<SafetyCertificateOutlined />}>
                管理区
              </Tag>
              <Typography.Text type="secondary">
                管理操作会被审计记录。
              </Typography.Text>
            </Space>
          </div>
          <div className="enterprise-header-right">
            <Badge status="processing" text={`角色: ${role}`} />
            <Typography.Text>{username}</Typography.Text>
            <Tooltip title={`切换到${theme === 'light' ? '深色' : '浅色'}模式`}>
              <Button
                size="small"
                icon={theme === 'light' ? <BulbOutlined /> : <BulbFilled />}
                onClick={toggleTheme}
              >
                {theme === 'light' ? '深色' : '浅色'}
              </Button>
            </Tooltip>
            <Button size="small" onClick={onLogout}>
              退出登录
            </Button>
          </div>
        </Header>
        <Content className="enterprise-content">
          <Breadcrumb items={breadcrumbs.map((b) => ({ title: b }))} />
          <div className="enterprise-content-body">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
