import { useEffect, useMemo, useState } from "react";
import { goHome } from "../app/router";
import { LineChart } from "../components/LineChart";
import { api, describeApiError, type GbncSeriesDetail, type GbncSeriesPoints } from "../lib/api";

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function SeriesDetailPage({ seriesId }: { seriesId: number }) {
  const [meta, setMeta] = useState<GbncSeriesDetail | null>(null);
  const [pts, setPts] = useState<GbncSeriesPoints | null>(null);
  const [msg, setMsg] = useState("Loading...");
  const metaObj = useMemo(() => asObj(meta?.meta), [meta?.meta]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getGbncSeries(seriesId), api.getGbncSeriesPoints(seriesId)])
      .then(([m, p]) => {
        if (cancelled) return;
        setMeta(m);
        setPts(p);
        setMsg("");
      })
      .catch((e) => {
        if (cancelled) return;
        setMsg(describeApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="row-inline" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>GBNC Series Detail</h2>
          <button onClick={goHome}>Back Home</button>
        </div>
        <div className="row-inline">
          <span className="mono">series_id={seriesId}</span>
          {meta && <span className="muted">word={meta.word}</span>}
          {meta && <span className="muted">variant={meta.variant}</span>}
        </div>
        {msg && <div className={msg.startsWith("404") || msg.startsWith("500") ? "error-text" : "muted"}>{msg}</div>}
      </section>
      {meta && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Metadata</h3>
          <div className="muted">
            source={meta.source} granularity={meta.granularity} points_count={meta.point_count} units={meta.units ?? "-"}
          </div>
          <div className="muted">updated_at={meta.updated_at ?? "-"}</div>
          <div className="muted">
            corpus={String(metaObj?.corpus ?? "-")} smoothing={String(metaObj?.smoothing ?? "-")} source_kind={String(metaObj?.source_kind ?? "-")}
          </div>
          <div className="muted">
            version(cache_key)={String(metaObj?.gbnc_cache_key ?? "-")}
          </div>
          <pre className="pre-block" style={{ marginTop: 8 }}>{JSON.stringify(meta?.meta ?? null, null, 2)}</pre>
        </section>
      )}
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Series Curve</h3>
        {pts && pts.items.length > 0 ? (
          <LineChart points={pts.items} title={`GBNC Series ${seriesId}`} />
        ) : (
          <div className="muted">No points for this series.</div>
        )}
      </section>
    </div>
  );
}
