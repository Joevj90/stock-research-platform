import type { PriceBar } from "@/lib/types";

/**
 * Minimal dependency-free SVG line chart of closing prices. Good enough for
 * the Phase 1 dashboard; swap for a proper charting library when technical
 * indicator overlays (Phase: "analyze price charts and technical
 * indicators") are built.
 */
export function PriceChart({ bars }: { bars: PriceBar[] }) {
  if (bars.length === 0) {
    return <div className="text-sm text-gray-500">No price history available.</div>;
  }

  const width = 800;
  const height = 240;
  const padding = 24;

  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const points = bars.map((bar, i) => {
    const x = padding + (i / (bars.length - 1 || 1)) * (width - padding * 2);
    const y = height - padding - ((bar.close - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const isUp = bars[bars.length - 1]!.close >= bars[0]!.close;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Price chart">
      <polyline
        fill="none"
        stroke={isUp ? "#22c55e" : "#ef4444"}
        strokeWidth={2}
        points={points.join(" ")}
      />
    </svg>
  );
}
