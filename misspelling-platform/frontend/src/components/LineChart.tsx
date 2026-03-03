import { useMemo, useState } from "react";

type Point = { time: string; value: number };
type Series = { name: string; points: Point[]; color?: string };

const PALETTE = ["#1d4ed8", "#0d9488", "#dc2626", "#7c3aed", "#2563eb", "#059669", "#b45309", "#be185d"];

function sanitizePoints(rows?: Point[]) {
  const safe: Point[] = [];
  for (const row of rows || []) {
    const value = Number((row as Point).value);
    const time = String((row as Point).time ?? "").trim();
    if (!time || !Number.isFinite(value)) continue;
    safe.push({ time, value });
  }
  return safe;
}

function normalizeSeries(points?: Point[], series?: Series[]) {
  if (series && series.length > 0) {
    return series
      .map((s) => ({ ...s, points: sanitizePoints(s.points) }))
      .filter((s) => (s.points || []).length > 0);
  }
  const safe = sanitizePoints(points);
  if (safe.length > 0) return [{ name: "series", points: safe, color: PALETTE[0] }];
  return [];
}

function formatValue(v: number) {
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toExponential(3);
}

export function LineChart({
  points,
  series,
  title
}: {
  points?: Point[];
  series?: Series[];
  title: string;
}) {
  const normalized = useMemo(() => normalizeSeries(points, series), [points, series]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverX, setHoverX] = useState<number | null>(null);

  if (normalized.length === 0) {
    return <div className="muted">No points.</div>;
  }

  const width = 920;
  const height = 320;
  const padLeft = 64;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 44;

  const visible = normalized.filter((s) => !hidden.has(s.name));
  const activeSeries = visible.length > 0 ? visible : normalized;
  const maxLength = Math.max(...activeSeries.map((s) => s.points.length));
  const xDomain = activeSeries[0].points.map((p) => p.time);
  const values = activeSeries.flatMap((s) => s.points.map((p) => p.value));
  const yMinRaw = Math.min(...values);
  const yMaxRaw = Math.max(...values);
  const yMin = Math.min(0, yMinRaw);
  const yMax = yMaxRaw <= yMin ? yMin + 1 : yMaxRaw;
  const span = yMax - yMin;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const stepX = maxLength <= 1 ? 0 : plotW / (maxLength - 1);

  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => yMin + ((yMax - yMin) * (yTickCount - i)) / yTickCount);

  const pathFor = (s: Series) =>
    s.points
      .map((p, i) => {
        const x = padLeft + i * stepX;
        const y = padTop + ((yMax - p.value) / span) * plotH;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");

  const hoverIndex = useMemo(() => {
    if (hoverX === null || maxLength <= 1) return null;
    const idx = Math.round((hoverX - padLeft) / stepX);
    return Math.max(0, Math.min(maxLength - 1, idx));
  }, [hoverX, maxLength, padLeft, stepX]);

  const hoverTime = hoverIndex === null ? null : xDomain[hoverIndex] ?? null;
  const hoverItems =
    hoverIndex === null
      ? []
      : activeSeries
          .map((s, idx) => ({ series: s, point: s.points[hoverIndex], color: s.color || PALETTE[idx % PALETTE.length] }))
          .filter((x) => !!x.point);

  return (
    <div className="chart-wrap">
      <div className="row-inline" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <strong>{title}</strong>
        <span className="muted">
          series={activeSeries.length} min={formatValue(yMinRaw)} max={formatValue(yMaxRaw)}
        </span>
      </div>
      <div className="row-inline" style={{ marginBottom: 6 }}>
        {normalized.map((s, idx) => {
          const color = s.color || PALETTE[idx % PALETTE.length];
          const off = hidden.has(s.name);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.name)) next.delete(s.name);
                  else next.add(s.name);
                  return next;
                })
              }
              style={{
                border: `1px solid ${color}`,
                color: off ? "#64748b" : color,
                background: off ? "#f8fafc" : "#ffffff",
                borderRadius: 14,
                padding: "2px 10px",
                cursor: "pointer"
              }}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={title}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const scale = width / Math.max(1, rect.width);
          const localX = (e.clientX - rect.left) * scale;
          setHoverX(localX);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        <rect x={padLeft} y={padTop} width={plotW} height={plotH} fill="#ffffff" />
        {yTicks.map((tick) => {
          const y = padTop + ((yMax - tick) / span) * plotH;
          return (
            <g key={`y-${tick}`}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {formatValue(tick)}
              </text>
            </g>
          );
        })}
        <line x1={padLeft} y1={height - padBottom} x2={width - padRight} y2={height - padBottom} stroke="#94a3b8" strokeWidth={1.2} />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} stroke="#94a3b8" strokeWidth={1.2} />
        {activeSeries.map((s, idx) => (
          <path key={s.name} d={pathFor(s)} fill="none" stroke={s.color || PALETTE[idx % PALETTE.length]} strokeWidth={2} />
        ))}
        {hoverIndex !== null && (
          <>
            <line
              x1={padLeft + hoverIndex * stepX}
              y1={padTop}
              x2={padLeft + hoverIndex * stepX}
              y2={height - padBottom}
              stroke="#475569"
              strokeDasharray="4,4"
              strokeWidth={1}
            />
            {hoverItems.map((item, idx) => {
              const y = padTop + ((yMax - item.point.value) / span) * plotH;
              return <circle key={`${item.series.name}-${idx}`} cx={padLeft + hoverIndex * stepX} cy={y} r={3.2} fill={item.color} />;
            })}
          </>
        )}
      </svg>
      {hoverIndex !== null && hoverTime && (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <strong>{hoverTime}</strong>
          <span className="muted"> | </span>
          {hoverItems.map((item, idx) => (
            <span key={`${item.series.name}-${idx}`} style={{ marginRight: 10, color: item.color }}>
              {item.series.name}: {formatValue(item.point.value)}
            </span>
          ))}
        </div>
      )}
      <div className="chart-axis">
        <span>{xDomain[0]}</span>
        <span>{xDomain[Math.floor(xDomain.length / 2)]}</span>
        <span>{xDomain[xDomain.length - 1]}</span>
      </div>
    </div>
  );
}
