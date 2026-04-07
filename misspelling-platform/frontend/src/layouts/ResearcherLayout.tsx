/* 文件说明：研究者布局组件，负责普通用户端的导航、页头与内容区框架。 */

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
    label: '总览',
    icon: <DashboardOutlined />,
    children: [
      { key: 'dashboard', label: '仪表盘' },
    ],
  },
  {
    key: 'workspace',
    label: '工作区',
    icon: <FileSearchOutlined />,
    children: [
      { key: 'word-analysis', label: '词分析' },
      { key: 'variants', label: '变体管理' },
    ],
  },
  {
    key: 'algorithms',
    label: '算法',
    icon: <FunctionOutlined />,
    children: [
      { key: 'simulation', label: '传播仿真' },
      { key: 'causal-network', label: '因果网络' },
      { key: 'steady-state', label: '稳态分析' },
      { key: 'delta-t-bias', label: 'DeltaT 偏差' },
    ],
  },
  {
    key: 'data',
    label: '数据与结果',
    icon: <BarChartOutlined />,
    children: [
      { key: 'tasks', label: '任务中心' },
      { key: 'time-series', label: '时序数据' },
      { key: 'artifacts', label: '产物库' },
      { key: 'reports', label: '报告中心' },
    ],
  },
  {
    key: 'system',
    label: '系统',
    icon: <SettingOutlined />,
    children: [
      { key: 'settings', label: '设置' },
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
            <span>错拼研究平台</span>
            <small>研究控制台</small>
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
              <Tag color={dbOk ? "green" : "red"}>DB {dbOk ? "正常" : "异常"}</Tag>
              <Tag color={llmEnabled ? "blue" : "default"}>LLM {llmEnabled ? "开启" : "关闭"}</Tag>
              <Tag color={gbncEnabled ? "geekblue" : "default"}>GBNC {gbncEnabled ? "开启" : "关闭"}</Tag>
            </Space>
          </div>
          <div className="enterprise-header-right">
            <Badge status={role === "admin" ? "processing" : "default"} text={`角色: ${role}`} />
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
