import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Stock Research Platform",
  description: "Ticker-driven stock research foundation (Phase 1).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-gray-100 antialiased">{children}</body>
    </html>
  );
}
