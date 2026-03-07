import { Empty } from 'antd';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  description?: string;
  image?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({ description = 'No data', image, children }: EmptyStateProps) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <Empty description={description} image={image}>
        {children}
      </Empty>
    </div>
  );
}
