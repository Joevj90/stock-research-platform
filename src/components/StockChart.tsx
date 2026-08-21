"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type MouseEventParams,
} from "lightweight-charts";
import type { PriceBar } from "@/lib/types";
import { simpleMovingAverage } from "@/lib/technical-indicators";

type ChartType = "candlestick" | "line";

const MA_CONFIG = [
  { period: 20, color: "#f59e0b", label: "MA20" },
  { period: 50, color: "#3b82f6", label: "MA50" },
  { period: 200, color: "#a855f7", label: "MA200" },
] as const;

/**
 * Standalone chart component. Deliberately takes only `bars: PriceBar[]`
 * (real data already fetched by the market-data service) — it never
 * fetches, generates, or fabricates its own data, and has no dependency
 * on anything AI-related. That's what keeps it reusable: any future page
 * that has a PriceBar[] (a comparison view, an AI analyst's supporting
 * chart, etc.) can drop this component in unchanged.
 */
export function StockChart({ bars }: { bars: PriceBar[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRef = useRef<Record<number, ISeriesApi<"Line">>>({});

  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [visibleMAs, setVisibleMAs] = useState<Set<number>>(new Set([20, 50]));
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  // Build the chart once, tear it down on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2430" },
        horzLines: { color: "#1f2430" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#232732" },
      timeScale: { borderColor: "#232732", timeVisible: false },
      height: 420,
      autoSize: true,
    });
    chartRef.current = chart;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#374151",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      setHoverInfo(buildHoverInfo(param, mainSeriesRef.current, volumeSeries));
    });

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the main price series whenever the data or chart type changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (mainSeriesRef.current) {
      chart.removeSeries(mainSeriesRef.current);
      mainSeriesRef.current = null;
    }

    if (chartType === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
      series.setData(bars.map(toCandlestick));
      mainSeriesRef.current = series;
    } else {
      const series = chart.addSeries(LineSeries, {
        color: "#3b82f6",
        lineWidth: 2,
      });
      series.setData(bars.map(toLinePoint));
      mainSeriesRef.current = series;
    }

    volumeSeriesRef.current?.setData(bars.map(toVolumeBar));
    chart.timeScale().fitContent();
  }, [bars, chartType]);

  // Rebuild moving-average overlays whenever the data or visible set changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const { period, color } of MA_CONFIG) {
      const shouldShow = visibleMAs.has(period);
      let series = maSeriesRef.current[period];

      if (shouldShow && !series) {
        series = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        maSeriesRef.current[period] = series;
      }
      if (!shouldShow && series) {
        chart.removeSeries(series);
        delete maSeriesRef.current[period];
        continue;
      }
      if (shouldShow && series) {
        const sma = simpleMovingAverage(bars, period);
        const points: LineData<Time>[] = bars
          .map((b, i) => ({ time: toUnixTime(b.timestamp), value: sma[i] }))
          .filter((p): p is LineData<Time> => p.value !== null && p.value !== undefined);
        series.setData(points);
      }
    }
  }, [bars, visibleMAs]);

  function toggleMA(period: number) {
    setVisibleMAs((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <ToggleButton active={chartType === "candlestick"} onClick={() => setChartType("candlestick")}>
            Candlestick
          </ToggleButton>
          <ToggleButton active={chartType === "line"} onClick={() => setChartType("line")}>
            Line
          </ToggleButton>
        </div>
        <div className="flex gap-1">
          {MA_CONFIG.map(({ period, color, label }) => (
            <ToggleButton
              key={period}
              active={visibleMAs.has(period)}
              onClick={() => toggleMA(period)}
              dotColor={color}
            >
              {label}
            </ToggleButton>
          ))}
        </div>
      </div>

      <div className="h-4 text-xs text-gray-400">
        {hoverInfo && (
          <span className="tabular-nums">
            {hoverInfo.date} · O {hoverInfo.open} H {hoverInfo.high} L {hoverInfo.low} C {hoverInfo.close}
            {hoverInfo.volume !== null && <> · Vol {hoverInfo.volume.toLocaleString()}</>}
          </span>
        )}
      </div>

      <div ref={containerRef} className="w-full" />

      <p className="text-xs text-gray-500">
        Scroll/pinch to zoom, drag to pan. Data from the market-data service — never generated in the
        browser.
      </p>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  dotColor,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dotColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-accent text-white" : "text-gray-400 hover:bg-panel hover:text-gray-200"
      }`}
    >
      {dotColor && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: active ? "white" : dotColor }}
        />
      )}
      {children}
    </button>
  );
}

interface HoverInfo {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number | null;
}

function buildHoverInfo(
  param: MouseEventParams<Time>,
  mainSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null,
  volumeSeries: ISeriesApi<"Histogram">
): HoverInfo | null {
  if (!param.time || !mainSeries) return null;

  const priceData = param.seriesData.get(mainSeries);
  const volumeData = param.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;
  if (!priceData) return null;

  const date = typeof param.time === "string" ? param.time : String(param.time);

  if ("open" in priceData) {
    const c = priceData as CandlestickData<Time>;
    return {
      date,
      open: c.open.toFixed(2),
      high: c.high.toFixed(2),
      low: c.low.toFixed(2),
      close: c.close.toFixed(2),
      volume: volumeData?.value ?? null,
    };
  }

  const l = priceData as LineData<Time>;
  const price = l.value.toFixed(2);
  return {
    date,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: volumeData?.value ?? null,
  };
}

function toUnixTime(iso: string): Time {
  return (Math.floor(new Date(iso).getTime() / 1000)) as Time;
}

function toCandlestick(bar: PriceBar): CandlestickData<Time> {
  return { time: toUnixTime(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close };
}

function toLinePoint(bar: PriceBar): LineData<Time> {
  return { time: toUnixTime(bar.timestamp), value: bar.close };
}

function toVolumeBar(bar: PriceBar): HistogramData<Time> {
  return {
    time: toUnixTime(bar.timestamp),
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)",
  };
}
