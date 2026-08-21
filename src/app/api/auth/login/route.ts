import { NextRequest, NextResponse } from "next/server";
import { env } from "@/server/config/env";
import { computeSiteToken, SITE_AUTH_COOKIE } from "@/lib/site-auth";
import { logger } from "@/server/logger";

const log = logger.child("api:auth:login");

export async function POST(req: NextRequest) {
  if (!env.SITE_PASSWORD) {
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "Site password is not configured." } },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
      { status: 400 }
    );
  }

  const password = (body as { password?: unknown }).password;
  if (typeof password !== "string" || password !== env.SITE_PASSWORD) {
    log.warn("failed login attempt");
    return NextResponse.json(
      { error: { code: "INCORRECT_PASSWORD", message: "Incorrect password." } },
      { status: 401 }
    );
  }

  const token = await computeSiteToken(env.SITE_PASSWORD);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_AUTH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
