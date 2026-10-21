import Link from "next/link";
import { TickerSearch } from "@/components/TickerSearch";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">AI Stock Research Platform</h1>
        <p className="max-w-md text-sm text-gray-400">
          Enter a ticker to open its research dashboard.
        </p>
      </div>
      <TickerSearch />
      <div className="flex items-center gap-4">
        <Link href="/watchlist" className="text-xs text-gray-400 hover:text-gray-200">
          Watchlist →
        </Link>
        <Link href="/suggestions" className="text-xs text-gray-400 hover:text-gray-200">
          Suggestions →
        </Link>
        <Link href="/pattern-lab" className="text-xs text-gray-500 hover:text-gray-300">
          Pattern Lab (experiment) →
        </Link>
      </div>
    </main>
  );
}
