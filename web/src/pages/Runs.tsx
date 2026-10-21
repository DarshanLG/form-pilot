import { useEffect, useState } from "react";
import { api, type Action, type Run, type Step } from "../api";

const runIdFromHash = () => location.hash.match(/^#\/runs\/([0-9a-f]{24})/)?.[1] ?? null;
const describe = (a: Action) => [a.action, a.mark != null ? `#${a.mark}` : "", a.value ? `"${a.value}"` : ""].filter(Boolean).join(" ");
const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.split("/").slice(0, 2).join("/");
  } catch {
    return url;
  }
};
const rate = (r: Run) => (r.counts.steps ? `${Math.round((r.counts.accepted / r.counts.steps) * 100)}%` : "—");

export function Runs() {
  const [id, setId] = useState(runIdFromHash);
  useEffect(() => {
    const onHash = () => setId(runIdFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return id ? <RunDetail id={id} /> : <RunList />;
}

function RunList() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api.runs().then(setRuns, (e) => setError(e.message)), []);
  if (error) return <p className="error">{error}</p>;
  if (!runs) return <p className="muted">Loading…</p>;
  if (!runs.length) return <p className="muted">No applications yet. Open a job form and click FormPilot in the toolbar.</p>;
  return (
    <section className="card">
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Form</th>
            <th>Status</th>
            <th className="num">Steps</th>
            <th className="num">Accepted</th>
            <th className="num">Corrections</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r._id} onClick={() => (location.hash = `#/runs/${r._id}`)} className="clickable">
              <td>{new Date(r.startedAt).toLocaleString()}</td>
              <td>
                <span className="tag">{r.platform}</span> {hostOf(r.url)}
              </td>
              <td>
                <span className={`pill ${r.status}`}>{r.status}</span>
              </td>
              <td className="num">{r.counts.steps}</td>
              <td className="num">{rate(r)}</td>
              <td className="num">{r.counts.edited + r.counts.overridden}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<(Run & { steps: Step[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api.run(id).then(setRun, (e) => setError(e.message)), [id]);
  if (error) return <p className="error">{error}</p>;
  if (!run) return <p className="muted">Loading…</p>;
  return (
    <>
      <p>
        <a href="#/runs">← All runs</a>
      </p>
      <section className="card">
        <h2>
          <a href={run.url} target="_blank" rel="noreferrer">
            {hostOf(run.url)}
          </a>{" "}
          <span className={`pill ${run.status}`}>{run.status}</span>
        </h2>
        <p className="muted small">
          {new Date(run.startedAt).toLocaleString()} · {run.counts.steps} steps · {rate(run)} accepted ·{" "}
          {run.counts.edited} edited · {run.counts.overridden} overridden
        </p>
      </section>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Model proposed</th>
              <th>Ran</th>
              <th>Decision</th>
              <th className="num">Latency</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((s) => (
              <tr key={s._id} className={s.decision}>
                <td className="num">{s.index + 1}</td>
                <td>
                  {describe(s.proposed)}
                  {s.fallback && <span className="tag warn">fallback</span>}
                  {s.proposed.thought && <div className="muted small">{s.proposed.thought}</div>}
                </td>
                <td>{s.decision === "accepted" ? <span className="muted">same</span> : describe(s.final)}</td>
                <td>
                  <span className={`pill ${s.decision}`}>{s.decision}</span>
                </td>
                <td className="num">{s.latency_ms != null ? `${(s.latency_ms / 1000).toFixed(1)} s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
