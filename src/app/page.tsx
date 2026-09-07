import Link from "next/link";
import { TickerSearch } from "@/components/TickerSearch";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">AI Stock Research Platform</h1>
        <p className="max-w-md text-sm text-gray-400">
          Enter a ticker to open its research dashboard. Phase 1 foundation — price data is
          mock/sample until a real market-data provider is connected.
        </p>
      </div>
      <TickerSearch />
      <Link href="/screener" className="text-xs text-accent hover:text-blue-400">
        Or scan the S&amp;P 500 for stocks the AI expects to gain 10%+ in a month →
      </Link>
    </main>
  );
}
