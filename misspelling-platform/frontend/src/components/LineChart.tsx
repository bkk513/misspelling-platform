type Point = { time: string; value: number };

export function LineChart({ points, title }: { points: Point[]; title: string }) {
  if (points.length === 0) {
    return <div className="muted">No points.</div>;
  }
  const width = 760;
  const height = 240;
  const pad = 30;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, points.length - 1);
  const d = points
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <div className="chart-wrap">
      <div className="row-inline" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <strong>{title}</strong>
        <span className="muted">min={min.toFixed(4)} max={max.toFixed(4)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={title}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#cbd5e1" />
        <path d={d} fill="none" stroke="#1d4ed8" strokeWidth="2" />
      </svg>
      <div className="chart-axis">
        <span>{points[0]?.time}</span>
        <span>{points[Math.floor(points.length / 2)]?.time}</span>
        <span>{points[points.length - 1]?.time}</span>
      </div>
    </div>
  );
}
