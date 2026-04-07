/* 文件说明：状态徽标组件，负责用统一样式呈现任务或系统状态。 */

import { Tag } from 'antd';
import type { TagProps } from 'antd';

type Status = 'success' | 'failure' | 'running' | 'pending' | 'deleted' | 'queued';

const statusConfig: Record<Status, { color: TagProps['color']; label: string }> = {
  success: { color: 'success', label: 'Success' },
  failure: { color: 'error', label: 'Failed' },
  running: { color: 'processing', label: 'Running' },
  pending: { color: 'default', label: 'Pending' },
  queued: { color: 'blue', label: 'Queued' },
  deleted: { color: 'default', label: 'Deleted' },
};

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase() as Status;
  const config = statusConfig[normalized] || { color: 'default', label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
}
