import { NextResponse } from "next/server";
import { getLatestScan } from "@/server/suggestions";

/** The most recent completed Trend Reset scan. One database read. */
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getLatestScan();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ scan: result.data }, { status: 200 });
}
