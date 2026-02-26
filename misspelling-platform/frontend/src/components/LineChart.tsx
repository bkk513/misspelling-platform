import { useEffect, useMemo, useState } from "react";

type Point = { time: string; value: number };
type Series = { name: string; points: Point[] };

type PlotRow = {
  name: string;
  color: string;
  visible: boolean;
  path: string;
  pointByTime: Map<string, Point>;
  renderedPoints: Array<{ x: number; y: number; t: string; value: number }>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function LineChart({ points, series, title }: { points?: Point[]; series?: Series[]; title: string }) {
  const mergedSeries = useMemo(
    () => (series && series.length ? series : [{ name: "series", points: points ?? [] }]).filter((s) => s.points.length > 0),
    [points, series]
  );
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    setHidden((prev) => {
      const next: Record<string, boolean> = {};
      for (const s of mergedSeries) if (prev[s.name]) next[s.name] = true;
      return next;
    });
    setHoverIndex(null);
  }, [mergedSeries]);

  if (mergedSeries.length === 0) {
    return <div className="muted">No points.</div>;
  }

  const width = 760;
  const height = 260;
  const pad = 34;
  const palette = ["#1d4ed8", "#15803d", "#b45309", "#0f766e", "#be123c", "#7c3aed", "#475569", "#0369a1"];
  const allVisiblePoints = mergedSeries
    .filter((s) => !hidden[s.name])
    .flatMap((s) => s.points);
  const fallbackPoints = mergedSeries.flatMap((s) => s.points);
  const values = (allVisiblePoints.length ? allVisiblePoints : fallbackPoints).map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const axisSeries = mergedSeries.reduce((best, cur) => (cur.points.length > best.points.length ? cur : best), mergedSeries[0]);
  const xLabels = axisSeries.points.map((p) => p.time);
  const stepX = (width - pad * 2) / Math.max(1, xLabels.length - 1);

  const plots: PlotRow[] = mergedSeries.map((s, idx) => {
    const renderedPoints = s.points.map((p, i) => {
      const x = pad + i * stepX;
      const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
      return { x, y, t: p.time, value: p.value };
    });
    return {
      name: s.name,
      color: palette[idx % palette.length],
      visible: !hidden[s.name],
      path: renderedPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" "),
      pointByTime: new Map(s.points.map((p) => [p.time, p])),
      renderedPoints,
    };
  });

  const visiblePlots = plots.filter((p) => p.visible);
  const safeHoverIndex = hoverIndex == null ? null : clamp(hoverIndex, 0, Math.max(0, xLabels.length - 1));
  const hoverTime = safeHoverIndex == null ? null : xLabels[safeHoverIndex] ?? null;
  const hoverX = safeHoverIndex == null ? null : pad + safeHoverIndex * stepX;
  const hoverRows =
    hoverTime == null
      ? []
      : visiblePlots
          .map((p) => ({ name: p.name, color: p.color, point: p.pointByTime.get(hoverTime) }))
          .filter((r) => r.point);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: height - pad - ratio * (height - pad * 2),
    value: (min + span * ratio).toFixed(4),
  }));

  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <div className="row-inline" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <strong>{title}</strong>
        <span className="muted">min={min.toFixed(4)} max={max.toFixed(4)}</span>
      </div>

      {hoverTime && hoverRows.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 12,
            zIndex: 2,
            maxWidth: 280,
            background: "rgba(17,24,39,0.95)",
            color: "#f8fafc",
            border: "1px solid #374151",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hoverTime}</div>
          {hoverRows.map((row) => (
            <div key={`${hoverTime}-${row.name}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ color: row.color }}>{row.name}</span>
              <span className="mono">{row.point?.value.toFixed(6)}</span>
            </div>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={title}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * width;
          const idx = Math.round((x - pad) / Math.max(stepX, 1));
          setHoverIndex(clamp(idx, 0, Math.max(0, xLabels.length - 1)));
        }}
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick.value}`}>
            <line x1={pad} y1={tick.y} x2={width - pad} y2={tick.y} stroke="#eef2f7" />
            <text x={6} y={tick.y + 4} fontSize="11" fill="#94a3b8">{tick.value}</text>
          </g>
        ))}
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#cbd5e1" />
        {visiblePlots.map((p) => (
          <path key={p.name} d={p.path} fill="none" stroke={p.color} strokeWidth="2" />
        ))}
        {hoverX != null && (
          <line x1={hoverX} y1={pad} x2={hoverX} y2={height - pad} stroke="#9ca3af" strokeDasharray="4 4" />
        )}
        {hoverTime &&
          visiblePlots.flatMap((p) => {
            const point = p.renderedPoints.find((rp) => rp.t === hoverTime);
            if (!point) return [];
            return [
              <circle key={`hover-${p.name}`} cx={point.x} cy={point.y} r="3.2" fill={p.color} stroke="#fff" strokeWidth="1" />,
            ];
          })}
      </svg>

      <div className="chart-legend">
        {plots.map((p) => (
          <button
            key={p.name}
            type="button"
            className="chart-legend-item"
            onClick={() => setHidden((prev) => ({ ...prev, [p.name]: !prev[p.name] }))}
            style={{
              border: "1px solid #e5e7eb",
              background: p.visible ? "#ffffff" : "#f3f4f6",
              opacity: p.visible ? 1 : 0.55,
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 999,
            }}
            title={p.visible ? "Hide series" : "Show series"}
          >
            <i style={{ background: p.color }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="chart-axis">
        <span>{xLabels[0]}</span>
        <span>{xLabels[Math.floor(xLabels.length / 2)]}</span>
        <span>{xLabels[xLabels.length - 1]}</span>
      </div>
    </div>
  );
}
