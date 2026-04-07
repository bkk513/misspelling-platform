/* 文件说明：时序图表组件，负责展示词频及算法结果相关的时间序列曲线。 */

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Register required components
echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  LineChart,
  CanvasRenderer,
]);

interface TimeSeriesChartProps {
  series: Array<{
    name: string;
    data: Array<{ time: string; value: number }>;
  }>;
  title?: string;
  height?: number;
  axisMode?: "log" | "linear";
}

function formatFrequency(value: unknown, digits = 6) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "-");
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1) return value.toFixed(Math.min(2, digits));
  if (abs >= 10 ** -Math.max(2, digits)) return value.toFixed(digits);
  return value.toExponential(2);
}

export function TimeSeriesChart({ series, title, height = 500, axisMode = "log" }: TimeSeriesChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts>();

  useEffect(() => {
    if (!chartRef.current) return;

    // Initialize chart
    const chart = echarts.init(chartRef.current);
    instanceRef.current = chart;

    // Prepare data
    const timePoints = series[0]?.data.map(d => d.time) || [];

    const positiveValues = series.flatMap((item) => item.data.map((point) => point.value)).filter((value) => value > 0);
    const logFloor = positiveValues.length ? Math.min(...positiveValues) / 10 : 1e-8;

    const useLogAxis = axisMode === "log";
    const option: echarts.EChartsOption = {
      title: {
        text: title || 'Time Series',
        left: 'center',
        textStyle: {
          fontSize: 16,
          fontWeight: 600,
        },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985',
          },
        },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return '';
          const time = params[0]?.axisValue || '';
          let result = `<strong>${time}</strong><br/>`;
          params.forEach((param: any) => {
            const rawValue = typeof param?.data?.raw === "number" ? param.data.raw : param.value;
            const value = formatFrequency(rawValue, 6);
            result += `${param.marker} ${param.seriesName}: <strong>${value}</strong><br/>`;
          });
          return result;
        },
      },
      legend: {
        data: series.map(s => s.name),
        top: 35,
        type: 'scroll',
        selected: series.reduce((acc, s, idx) => {
          // Default: show first 5 series
          acc[s.name] = idx < 5;
          return acc;
        }, {} as Record<string, boolean>),
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: 80,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: timePoints,
        axisLabel: {
          rotate: 45,
          fontSize: 11,
        },
      },
      yAxis: {
        type: useLogAxis ? 'log' : 'value',
        logBase: 10,
        min: useLogAxis ? logFloor : 0,
        name: useLogAxis ? 'Frequency (log10)' : 'Frequency',
        axisLabel: {
          formatter: (value: number) => formatFrequency(value, 2),
        },
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 30,
          bottom: 10,
        },
      ],
      series: series.map((s, idx) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        data: s.data.map((d) => ({ value: useLogAxis ? (d.value > 0 ? d.value : logFloor) : d.value, raw: d.value })),
        emphasis: {
          focus: 'series',
        },
        lineStyle: {
          width: 2,
        },
        showSymbol: false,
        // Use different colors for different series
        color: undefined, // Let ECharts auto-assign colors
      })),
    };

    chart.setOption(option);

    // Handle resize
    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
    };
  }, [series, title, height, axisMode]);

  return (
    <div
      ref={chartRef}
      style={{
        width: '100%',
        height: `${height}px`,
        marginTop: 16,
      }}
    />
  );
}
