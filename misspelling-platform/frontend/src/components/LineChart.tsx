type Point = { time: string; value: number };
type Series = { name: string; points: Point[] };

export function LineChart({ points, series, title }: { points?: Point[]; series?: Series[]; title: string }) {
  const mergedSeries = (series && series.length ? series : [{ name: "series", points: points ?? [] }]).filter((s) => s.points.length > 0);
  if (mergedSeries.length === 0) {
    return <div className="muted">No points.</div>;
  }
  const width = 760;
  const height = 240;
  const pad = 30;
  const palette = ["#1d4ed8", "#15803d", "#b45309", "#9333ea", "#be123c", "#0f766e"];
  const allPoints = mergedSeries.flatMap((s) => s.points);
  const values = allPoints.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const longest = mergedSeries.reduce((n, s) => Math.max(n, s.points.length), 0);
  const stepX = (width - pad * 2) / Math.max(1, longest - 1);
  const paths = mergedSeries.map((s, idx) => ({
    name: s.name,
    color: palette[idx % palette.length],
    d: s.points
      .map((p, i) => {
        const x = pad + i * stepX;
        const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" "),
  }));
  const refPoints = mergedSeries[0].points;

  return (
    <div className="chart-wrap">
      <div className="row-inline" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <strong>{title}</strong>
        <span className="muted">min={min.toFixed(4)} max={max.toFixed(4)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={title}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#cbd5e1" />
        {paths.map((p) => (
          <path key={p.name} d={p.d} fill="none" stroke={p.color} strokeWidth="2" />
        ))}
      </svg>
      <div className="chart-legend">
        {paths.map((p) => (
          <span key={p.name} className="chart-legend-item">
            <i style={{ background: p.color }} />
            {p.name}
          </span>
        ))}
      </div>
      <div className="chart-axis">
        <span>{refPoints[0]?.time}</span>
        <span>{refPoints[Math.floor(refPoints.length / 2)]?.time}</span>
        <span>{refPoints[refPoints.length - 1]?.time}</span>
      </div>
    </div>
  );
}
