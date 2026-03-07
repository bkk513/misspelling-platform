import type { ThemeConfig } from 'antd';

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1677ff',

    colorTextBase: '#1f2937',
    colorBgBase: '#ffffff',

    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", sans-serif',
    fontSize: 14,

    borderRadius: 6,

    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 64,
      headerPadding: '0 24px',
      siderBg: '#001529',
      bodyBg: '#f5f5f5',
    },
    Menu: {
      darkItemBg: '#001529',
      darkItemSelectedBg: '#1677ff',
      darkItemHoverBg: '#1f3a5f',
    },
    Table: {
      headerBg: '#fafafa',
      headerColor: '#1f2937',
      rowHoverBg: '#f5f5f5',
    },
    Card: {
      headerBg: 'transparent',
      boxShadowTertiary: '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
    },
    Button: {
      primaryShadow: '0 2px 0 rgba(5, 145, 255, 0.1)',
    },
  },
};

export const darkTheme: ThemeConfig = {
  ...lightTheme,
  token: {
    ...lightTheme.token,
    colorTextBase: '#f9fafb',
    colorBgBase: '#111827',
  },
  components: {
    ...lightTheme.components,
    Layout: {
      ...lightTheme.components?.Layout,
      headerBg: '#1f2937',
      siderBg: '#111827',
      bodyBg: '#0f172a',
    },
  },
};
