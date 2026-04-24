import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Static assets, Next internals, fonts, API auth endpoints
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/fonts") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/api/auth")
  )
    return true;
  return false;
}

function isConsultantOnlyPath(pathname: string): boolean {
  // Customer cannot reach the assessment page.
  // URL shape: /projects/{id}/assessment(?|/|$)
  const m = pathname.match(/^\/projects\/[^/]+\/(assessment)(?:\/|$)/);
  return !!m;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get("zgrc_session")?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (session.role !== "consultant" && isConsultantOnlyPath(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/forbidden";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static asset patterns
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
