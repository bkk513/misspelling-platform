import { Alert, Card, Space, Table, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import { api, type TaskListItem } from "../lib/api";

export function ResearcherSettingsPage() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);

  useEffect(() => {
    void api.listTasks(40).then((v) => setTasks(v.items ?? [])).catch(() => setTasks([]));
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="Access Policy">
        <Alert
          type="info"
          showIcon
          message="Guest mode enabled (demo policy)"
          description="当前为演示环境：Guest 可访问研究者模块。后续将开启 owner 绑定，实现“我的任务/我的数据”严格隔离。"
        />
      </Card>
      <Card title="Task Visibility Preview">
        <Tabs
          items={[
            {
              key: "my",
              label: "My Tasks (TODO)",
              children: <Typography.Paragraph type="secondary">当前阶段与 All Tasks 视图一致，owner 绑定待下一里程碑接入。</Typography.Paragraph>
            },
            {
              key: "all",
              label: "All Tasks",
              children: (
                <Table
                  size="small"
                  rowKey="task_id"
                  dataSource={tasks}
                  pagination={{ pageSize: 6 }}
                  columns={[
                    { title: "Task ID", dataIndex: "task_id" },
                    { title: "Type", dataIndex: "task_type" },
                    { title: "Status", dataIndex: "status" }
                  ]}
                />
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
