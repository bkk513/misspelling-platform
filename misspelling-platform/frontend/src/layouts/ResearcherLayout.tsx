import {
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  FunctionOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LineChartOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  TagsOutlined,
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
    type: 'group',
    children: [
      { key: 'dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
    ],
  },
  {
    key: 'workspace',
    label: 'Workspace',
    type: 'group',
    children: [
      { key: 'word-analysis', label: 'Word Analysis', icon: <FileSearchOutlined /> },
      { key: 'variants', label: 'Variant Studio', icon: <TagsOutlined /> },
      { key: 'projects', label: 'Project Manager', icon: <FolderOpenOutlined /> },
    ],
  },
  {
    key: 'algorithms',
    label: 'Algorithms',
    type: 'group',
    children: [
      { key: 'causal-network', label: 'Causal Network', icon: <FunctionOutlined /> },
      { key: 'steady-state', label: 'Steady State', icon: <FunctionOutlined /> },
      { key: 'delta-t-bias', label: 'DeltaT Bias', icon: <FunctionOutlined /> },
    ],
  },
  {
    key: 'data',
    label: 'Data & Results',
    type: 'group',
    children: [
      { key: 'tasks', label: 'Task Center', icon: <AppstoreOutlined /> },
      { key: 'time-series', label: 'Time Series', icon: <LineChartOutlined /> },
      { key: 'artifacts', label: 'Artifact Library', icon: <BarChartOutlined /> },
      { key: 'analytics', label: 'Analytics Center', icon: <NodeIndexOutlined /> },
      { key: 'reports', label: 'Report Center', icon: <FileTextOutlined /> },
    ],
  },
  {
    key: 'system',
    label: 'System',
    type: 'group',
    children: [
      { key: 'settings', label: 'Settings', icon: <SettingOutlined /> },
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
        <div className="enterprise-logo">Researcher Console</div>
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
            <Tag color={dbOk ? "green" : "red"}>DB {dbOk ? "OK" : "DOWN"}</Tag>
            <Tag color={llmEnabled ? "blue" : "default"}>LLM {llmEnabled ? "ON" : "OFF"}</Tag>
            <Tag color={gbncEnabled ? "geekblue" : "default"}>GBNC {gbncEnabled ? "ON" : "OFF"}</Tag>
          </Space>
          <Space size="middle">
            <Badge status={role === "admin" ? "processing" : "default"} text={`role:${role}`} />
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
