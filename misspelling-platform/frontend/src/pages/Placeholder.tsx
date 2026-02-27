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