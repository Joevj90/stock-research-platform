/** A collapsed-by-default wrapper around an existing panel, so the
 * detailed analyst reports stay available for anyone who wants to
 * inspect them without competing with the Final Report for attention.
 * Uses native <details>/<summary> deliberately -- accessible and
 * keyboard-operable with zero extra client-side state. */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group rounded-xl border border-border bg-panel/40 open:bg-transparent"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer select-none items-center justify-between px-6 py-4 text-sm font-medium text-gray-300 hover:text-gray-100">
        <span>{title}</span>
        <span className="text-xs text-gray-500 transition-transform group-open:rotate-180">▼</span>
      </summary>
      <div className="px-0 pb-0">{children}</div>
    </details>
  );
}
