import Link from "next/link";
import { ScreenerPanel } from "@/components/ScreenerPanel";

export default function ScreenerPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
          ← Back to search
        </Link>
      </div>
      <ScreenerPanel />
    </main>
  );
}
