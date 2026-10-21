import type { Stats } from "./api";

type Day = Stats["daily"][number];

export interface Point {
  x: number;
  y: number;
  day: Day;
}

/** Map daily acceptance rates to SVG coordinates: x spreads days evenly, y is 0–100% top to bottom. */
export function layout(daily: Day[], width: number, height: number, pad = 28): Point[] {
  const w = width - pad * 2;
  const h = height - pad * 2;
  return daily.map((day, i) => ({
    x: pad + (daily.length === 1 ? w / 2 : (i / (daily.length - 1)) * w),
    y: pad + (1 - day.rate) * h,
    day,
  }));
}

/** Acceptance rate per day: the share of proposed actions the user ran unchanged. */
export function RateChart({ daily }: { daily: Day[] }) {
  const W = 640;
  const H = 220;
  const pts = layout(daily, W, H);
  if (!pts.length) return <p className="muted">No steps logged yet. Fill an application with the extension.</p>;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Acceptance rate per day">
      {[0, 0.5, 1].map((r) => {
        const y = 28 + (1 - r) * (H - 56);
        return (
          <g key={r}>
            <line x1={28} x2={W - 28} y1={y} y2={y} className="grid" />
            <text x={4} y={y + 4} className="tick">{`${r * 100}%`}</text>
          </g>
        );
      })}
      <path d={path} className="line" />
      {pts.map((p) => (
        <g key={p.day.day}>
          <circle cx={p.x} cy={p.y} r={4} className="dot">
            <title>{`${p.day.day}: ${(p.day.rate * 100).toFixed(0)}% of ${p.day.steps} steps accepted`}</title>
          </circle>
          {pts.length <= 14 && (
            <text x={p.x} y={H - 6} className="tick" textAnchor="middle">
              {p.day.day.slice(5)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
