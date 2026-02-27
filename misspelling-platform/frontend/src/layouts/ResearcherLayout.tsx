import {
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  LineChartOutlined,
  SettingOutlined,
  TagsOutlined
} from "@ant-design/icons";
import { Badge, Breadcrumb, Button, Layout, Menu, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";

const { Header, Sider, Content } = Layout;

type MenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
};

const menuItems: MenuItem[] = [
  { key: "dashboard", label: "Dashboard", icon: <DashboardOutlined /> },
  { key: "tasks", label: "Task Center", icon: <AppstoreOutlined /> },
  { key: "word-analysis", label: "Word Analysis", icon: <FileSearchOutlined /> },
  { key: "variants", label: "Variant Studio", icon: <TagsOutlined /> },
  { key: "time-series", label: "Time Series", icon: <LineChartOutlined /> },
  { key: "artifacts", label: "Artifact Library", icon: <BarChartOutlined /> },
  { key: "reports", label: "Report Center", icon: <FileTextOutlined /> },
  { key: "settings", label: "Researcher Settings", icon: <SettingOutlined /> }
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
  return (
    <Layout className="enterprise-layout">
      <Sider width={250} className="enterprise-sider" theme="dark">
        <div className="enterprise-logo">Researcher Console</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[routeKey]}
          items={menuItems.map((item) => ({ key: item.key, icon: item.icon, label: item.label }))}
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