export function MockDataBanner({ provider }: { provider: string }) {
  return (
    <div className="rounded-lg border border-yellow-700/40 bg-yellow-900/20 px-4 py-2 text-xs text-yellow-300">
      <strong>Mock data</strong> — generated locally by the &quot;{provider}&quot; provider, not real
      market data. Connect a real provider (set{" "}
      <code className="rounded bg-black/30 px-1">MARKET_DATA_PROVIDER</code>) to replace this.
    </div>
  );
}
