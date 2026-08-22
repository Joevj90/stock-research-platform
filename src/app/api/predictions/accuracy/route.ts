import { NextResponse } from "next/server";
import { getAccuracyDashboard } from "@/server/predictions";

export async function GET() {
  const dashboard = await getAccuracyDashboard();
  return NextResponse.json(dashboard);
}
