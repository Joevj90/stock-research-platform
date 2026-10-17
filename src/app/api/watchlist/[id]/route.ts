import { NextResponse } from "next/server";
import { removeFromWatchlist, updateWatchlistNotes } from "@/server/watchlist";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const result = await removeFromWatchlist(params.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ removed: result.data.id }, { status: 200 });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Expected a JSON body." } }, { status: 400 });
  }

  const { notes } = (body ?? {}) as { notes?: unknown };
  if (typeof notes !== "string") {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "notes must be a string." } }, { status: 400 });
  }

  const result = await updateWatchlistNotes(params.id, notes);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ item: result.data }, { status: 200 });
}
