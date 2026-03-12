import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

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

    borderRadius: 8,

    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
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
      itemBorderRadius: 6,
      itemMarginInline: 4,
      itemPaddingInline: 16,
    },
    Table: {
      headerBg: '#fafbfc',
      headerColor: '#4b5563',
      rowHoverBg: '#f9fafb',
      borderRadius: 8,
    },
    Card: {
      headerBg: 'transparent',
      borderRadiusLG: 12,
      boxShadowTertiary: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 4px rgba(0, 0, 0, 0.02)',
    },
    Button: {
      primaryShadow: '0 2px 4px rgba(24, 144, 255, 0.15)',
      borderRadius: 8,
      controlHeight: 36,
      controlHeightLG: 44,
      controlHeightSM: 28,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
      paddingBlock: 8,
      paddingInline: 14,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
    },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    // Base colors (keep vibrant)
    colorPrimary: '#1890ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1890ff',

    // Background color hierarchy (from dark to light)
    colorBgBase: '#141414',           // Deepest layer
    colorBgContainer: '#1f1f1f',      // Containers (cards, panels)
    colorBgElevated: '#2a2a2a',       // Floating (modals, dropdowns)
    colorBgLayout: '#0a0a0a',         // Layout background (darker)

    // Text colors (using rgba for better contrast)
    colorTextBase: 'rgba(255, 255, 255, 0.85)',
    colorText: 'rgba(255, 255, 255, 0.85)',
    colorTextSecondary: 'rgba(255, 255, 255, 0.65)',
    colorTextTertiary: 'rgba(255, 255, 255, 0.45)',
    colorTextQuaternary: 'rgba(255, 255, 255, 0.25)',

    // Borders (using transparency for visibility)
    colorBorder: 'rgba(255, 255, 255, 0.12)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',

    // Font and sizing
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", sans-serif',
    fontSize: 14,
    borderRadius: 8,
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
  },
  components: {
    Layout: {
      headerBg: '#1f1f1f',
      siderBg: '#141414',
      bodyBg: '#0a0a0a',
      headerHeight: 64,
      headerPadding: '0 24px',
    },
    Menu: {
      darkItemBg: '#141414',
      darkItemSelectedBg: '#1890ff',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
      darkSubMenuItemBg: '#0a0a0a',
      itemBorderRadius: 6,
      itemMarginInline: 4,
      itemPaddingInline: 16,
    },
    Table: {
      headerBg: '#1a1a1a',
      headerColor: 'rgba(255, 255, 255, 0.85)',
      rowHoverBg: 'rgba(255, 255, 255, 0.03)',
      borderRadius: 8,
    },
    Card: {
      headerBg: 'transparent',
      colorBgContainer: '#1f1f1f',
      borderRadiusLG: 12,
    },
    Button: {
      primaryShadow: '0 2px 4px rgba(24, 144, 255, 0.2)',
      borderRadius: 8,
      controlHeight: 36,
      controlHeightLG: 44,
      controlHeightSM: 28,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
      paddingBlock: 8,
      paddingInline: 14,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
    },
  },
};
