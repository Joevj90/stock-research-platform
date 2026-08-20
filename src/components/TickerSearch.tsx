"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function TickerSearch({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  const router = useRouter();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ticker = value.trim().toUpperCase();
    if (!ticker) return;
    router.push(`/stock/${encodeURIComponent(ticker)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter a ticker — e.g. AAPL, NVDA, TSLA"
        autoFocus
        spellCheck={false}
        className="flex-1 rounded-lg border border-border bg-panel px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-500"
      >
        Research
      </button>
    </form>
  );
}
