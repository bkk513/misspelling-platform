/* 文件说明：前端主题配置模块，负责整理组件主题所需的配色与样式参数。 */

import type { ThemeConfig } from "antd";
import { theme } from "antd";

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: "#135bdb",
    colorSuccess: "#148758",
    colorWarning: "#d97706",
    colorError: "#d94841",
    colorInfo: "#135bdb",

    colorTextBase: "#122033",
    colorBgBase: "#ffffff",
    colorBgLayout: "#edf3fb",
    colorBorder: "#dbe4f0",
    colorBorderSecondary: "#e7edf6",

    fontFamily:
      '"IBM Plex Sans", "Avenir Next", "Segoe UI Variable", "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    borderRadius: 12,

    controlHeight: 38,
    controlHeightLG: 44,
    controlHeightSM: 30,
  },
  components: {
    Layout: {
      headerBg: "rgba(252, 254, 255, 0.82)",
      headerHeight: 74,
      headerPadding: "0 24px",
      siderBg: "#132033",
      bodyBg: "#edf3fb",
    },
    Menu: {
      darkItemBg: "transparent",
      darkItemSelectedBg: "#135bdb",
      darkItemHoverBg: "rgba(255, 255, 255, 0.08)",
      darkSubMenuItemBg: "transparent",
      itemBorderRadius: 10,
      itemMarginInline: 10,
      itemPaddingInline: 16,
    },
    Table: {
      headerBg: "#f5f8fd",
      headerColor: "#33465f",
      rowHoverBg: "#eff5ff",
      borderRadius: 12,
    },
    Card: {
      headerBg: "transparent",
      borderRadiusLG: 20,
      boxShadowTertiary: "0 18px 34px rgba(12, 22, 37, 0.06)",
    },
    Button: {
      primaryShadow: "0 10px 18px rgba(19, 91, 219, 0.22)",
      borderRadius: 12,
      controlHeight: 38,
      controlHeightLG: 44,
      controlHeightSM: 30,
    },
    Input: {
      borderRadius: 12,
      controlHeight: 38,
      paddingBlock: 8,
      paddingInline: 14,
    },
    InputNumber: {
      borderRadius: 12,
      controlHeight: 38,
    },
    Select: {
      borderRadius: 12,
      controlHeight: 38,
    },
    Tag: {
      borderRadiusSM: 999,
    },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#4e93ff",
    colorSuccess: "#2bb07b",
    colorWarning: "#e49d36",
    colorError: "#e46a62",
    colorInfo: "#4e93ff",

    colorBgBase: "#121926",
    colorBgContainer: "#182131",
    colorBgElevated: "#202b3f",
    colorBgLayout: "#0f1520",

    colorTextBase: "rgba(255, 255, 255, 0.92)",
    colorText: "rgba(255, 255, 255, 0.92)",
    colorTextSecondary: "rgba(255, 255, 255, 0.62)",
    colorTextTertiary: "rgba(255, 255, 255, 0.48)",
    colorTextQuaternary: "rgba(255, 255, 255, 0.3)",

    colorBorder: "rgba(255, 255, 255, 0.12)",
    colorBorderSecondary: "rgba(255, 255, 255, 0.18)",
    fontFamily:
      '"IBM Plex Sans", "Avenir Next", "Segoe UI Variable", "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    borderRadius: 12,
    controlHeight: 38,
    controlHeightLG: 44,
    controlHeightSM: 30,
  },
  components: {
    Layout: {
      headerBg: "rgba(20, 28, 40, 0.82)",
      siderBg: "#121b2a",
      bodyBg: "#0f1520",
      headerHeight: 74,
      headerPadding: "0 24px",
    },
    Menu: {
      darkItemBg: "transparent",
      darkItemSelectedBg: "#2f6ccb",
      darkItemHoverBg: "rgba(78, 147, 255, 0.16)",
      darkSubMenuItemBg: "transparent",
      itemBorderRadius: 10,
      itemMarginInline: 10,
      itemPaddingInline: 16,
    },
    Table: {
      headerBg: "#223047",
      headerColor: "rgba(255, 255, 255, 0.92)",
      rowHoverBg: "rgba(78, 147, 255, 0.14)",
      borderRadius: 12,
    },
    Card: {
      headerBg: "transparent",
      colorBgContainer: "#182131",
      borderRadiusLG: 20,
      boxShadowTertiary: "0 22px 42px rgba(0, 0, 0, 0.34)",
    },
    Button: {
      primaryShadow: "0 10px 22px rgba(78, 147, 255, 0.28)",
      borderRadius: 12,
      controlHeight: 38,
      controlHeightLG: 44,
      controlHeightSM: 30,
    },
    Input: {
      borderRadius: 12,
      controlHeight: 38,
      paddingBlock: 8,
      paddingInline: 14,
    },
    InputNumber: {
      borderRadius: 12,
      controlHeight: 38,
    },
    Select: {
      borderRadius: 12,
      controlHeight: 38,
    },
    Tag: {
      borderRadiusSM: 999,
    },
  },
};
