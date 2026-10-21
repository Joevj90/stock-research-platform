"use client";

import { useState } from "react";

/**
 * What the Trend Reset backtest did and did not show. Shared by the
 * Watchlist and Suggestions pages so the two can never quote different
 * numbers. The figures come from the offline backtest summarised at the
 * top of src/lib/trend-reset.ts; change them there and here together.
 */
export function TrendResetEvidenceNote() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-yellow-700/40 bg-yellow-900/10 p-3 text-xs text-yellow-300">
      <p>
        <span className="font-semibold">Meeting all four conditions is not a buy signal.</span> Backtested over
        2008–2026 on 493 stocks, Trend Reset beat comparable random picks by about 0.78% per trade over roughly three
        months. Real, but modest and uneven — and more than half of individual trades lost money.
      </p>
      <button onClick={() => setOpen((v) => !v)} className="mt-1 underline underline-offset-2">
        {open ? "Hide the detail" : "What the test did and didn't show"}
      </button>
      {open && (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
          <li>Positive in 16 of 19 calendar years, and not explained by the 2009 or 2020 rebounds.</li>
          <li>About half the total edge came from roughly 5 months out of 213. Most months were near a coin flip.</li>
          <li>Win rate 38.9%; the median trade lost 2.41%. The average is carried by a minority of large winners.</li>
          <li>
            The portfolio&apos;s 2.3-point annual advantage sits inside the 1–4 point range that survivorship bias
            alone could explain, because the test could only use companies still in the index today.
          </li>
          <li>
            What was tested: buy at the next open after all four conditions hold; sell after 63 trading days (about 3
            months) or at the first close below the 200-day average, whichever comes first; 0.1% round-trip cost.
          </li>
          <li>Backtested on a ~3 month hold. Nothing here has been tested as a short-term trade.</li>
        </ul>
      )}
    </section>
  );
}

