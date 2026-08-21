"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { HISTORICAL_PERIODS, type HistoricalPeriod } from "@/lib/types";

export function PeriodSelector({ current }: { current: HistoricalPeriod }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectPeriod(period: HistoricalPeriod) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", period);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex gap-1">
      {HISTORICAL_PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => selectPeriod(p)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            p === current
              ? "bg-accent text-white"
              : "text-gray-400 hover:bg-panel hover:text-gray-200"
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
