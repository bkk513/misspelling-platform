/* 文件说明：占位页面组件，负责为暂未开放或暂未实现的页面提供统一占位。 */

import { Alert, Card, Typography } from "antd";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <Card title={title}>
      <Alert
        type="info"
        showIcon
        message="Module scaffolding ready"
        description="This page is intentionally initialized for the enterprise module layout."
        style={{ marginBottom: 16 }}
      />
      <Typography.Paragraph>{description}</Typography.Paragraph>
    </Card>
  );
}