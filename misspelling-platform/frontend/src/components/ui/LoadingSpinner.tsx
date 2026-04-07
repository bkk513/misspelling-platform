/* 文件说明：加载组件，负责展示页面或模块加载中的反馈状态。 */

import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

interface LoadingSpinnerProps {
  size?: 'small' | 'default' | 'large';
  tip?: string;
}

export function LoadingSpinner({ size = 'default', tip }: LoadingSpinnerProps) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <Spin indicator={<LoadingOutlined style={{ fontSize: size === 'large' ? 48 : size === 'small' ? 24 : 32 }} spin />} tip={tip} />
    </div>
  );
}
