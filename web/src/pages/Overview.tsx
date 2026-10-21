import { useEffect, useState } from "react";
import { api, type Stats } from "../api";
import { RateChart } from "../chart";

const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(0)}%`);

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api.stats().then(setStats, (e) => setError(e.message)), []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;
  const corrections = stats.totals.edited + stats.totals.overridden;
  return (
    <>
      <section className="tiles">
        <Tile label="Acceptance rate" value={pct(stats.rate)} hint="proposals you ran unchanged" />
        <Tile label="Applications" value={String(stats.runs)} />
        <Tile label="Steps" value={String(stats.totals.steps)} />
        <Tile label="Corrections" value={String(corrections)} hint="edits + overrides, saved for retraining" />
      </section>

      <section className="card">
        <h2>Acceptance rate over time</h2>
        <RateChart daily={stats.daily} />
        <p className="muted small">
          A live signal from your own runs, not a benchmark: model accuracy is measured on the frozen test split by{" "}
          <code>ml/eval.py</code> (see <code>ml/RESULTS.md</code>).
        </p>
      </section>

      <section className="card row">
        <div>
          <h2>Corrections</h2>
          <p className="muted small">
            {stats.corrections} correction{stats.corrections === 1 ? "" : "s"} with screenshots, ready for the Phase 7
            retrain. The export includes your profile: save it under <code>data/</code> and never commit it.
          </p>
        </div>
        <a className="button" href={api.correctionsExportUrl} download>
          Export JSONL
        </a>
      </section>
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}
