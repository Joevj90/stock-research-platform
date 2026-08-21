import { NextRequest, NextResponse } from "next/server";
import { computeSiteToken, SITE_AUTH_COOKIE } from "@/lib/site-auth";

/**
 * Site-wide password gate. Reads SITE_PASSWORD directly from process.env
 * (not the Zod-validated `env` from server/config/env.ts) because
 * middleware runs on the Edge runtime and that module pulls in
 * DATABASE_URL validation that has no business running here.
 *
 * If SITE_PASSWORD isn't set, the gate is a no-op — the app stays fully
 * open, same as before. Set SITE_PASSWORD to turn it on.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SITE_AUTH_COOKIE)?.value;
  const expected = await computeSiteToken(password);

  if (cookie === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Gate every route (pages AND API routes) except static assets and the
  // login page/endpoint itself — otherwise nobody could ever reach the
  // login page to authenticate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/auth/login).*)"],
};
