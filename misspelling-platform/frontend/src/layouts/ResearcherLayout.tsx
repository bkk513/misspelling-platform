import {
  BarChartOutlined,
  DashboardOutlined,
  FunctionOutlined,
  FileSearchOutlined,
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
    key: 'overview',
    label: 'Overview',
    icon: <DashboardOutlined />,
    children: [
      { key: 'dashboard', label: 'Dashboard' },
    ],
  },
  {
    key: 'workspace',
    label: 'Workspace',
    icon: <FileSearchOutlined />,
    children: [
      { key: 'word-analysis', label: 'Word Analysis' },
      { key: 'variants', label: 'Variant Studio' },
      { key: 'projects', label: 'Project Manager' },
    ],
  },
  {
    key: 'algorithms',
    label: 'Algorithms',
    icon: <FunctionOutlined />,
    children: [
      { key: 'simulation', label: 'Simulation' },
      { key: 'causal-network', label: 'Causal Network' },
      { key: 'steady-state', label: 'Steady State' },
      { key: 'delta-t-bias', label: 'DeltaT Bias' },
    ],
  },
  {
    key: 'data',
    label: 'Data & Results',
    icon: <BarChartOutlined />,
    children: [
      { key: 'tasks', label: 'Task Center' },
      { key: 'time-series', label: 'Time Series' },
      { key: 'artifacts', label: 'Artifact Library' },
      { key: 'analytics', label: 'Analytics Center' },
      { key: 'reports', label: 'Report Center' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    icon: <SettingOutlined />,
    children: [
      { key: 'settings', label: 'Settings' },
    ],
  },
];

export function ResearcherLayout({
  routeKey,
  breadcrumbs,
  llmEnabled,
  gbncEnabled,
  dbOk,
  username,
  role,
  onLogout,
  onNavigate,
  children
}: {
  routeKey: string;
  breadcrumbs: string[];
  llmEnabled: boolean;
  gbncEnabled: boolean;
  dbOk: boolean;
  username: string;
  role: string;
  onLogout: () => void;
  onNavigate: (key: string) => void;
  children: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <Layout className="enterprise-layout">
      <Sider width={250} className="enterprise-sider" theme="dark">
        <div className="enterprise-logo">
          <div className="enterprise-logo-inner">
            <span>Misspelling Research OS</span>
            <small>Researcher Console</small>
          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[routeKey]}
          defaultOpenKeys={['overview', 'workspace', 'data']}
          items={menuItems}
          onClick={({ key }) => onNavigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="enterprise-header">
          <div className="enterprise-header-left">
            <Space size={8} wrap>
              <Tag color={dbOk ? "green" : "red"}>DB {dbOk ? "OK" : "DOWN"}</Tag>
              <Tag color={llmEnabled ? "blue" : "default"}>LLM {llmEnabled ? "ON" : "OFF"}</Tag>
              <Tag color={gbncEnabled ? "geekblue" : "default"}>GBNC {gbncEnabled ? "ON" : "OFF"}</Tag>
            </Space>
          </div>
          <div className="enterprise-header-right">
            <Badge status={role === "admin" ? "processing" : "default"} text={`role: ${role}`} />
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
