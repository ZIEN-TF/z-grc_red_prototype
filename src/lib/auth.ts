// Simple session auth: bcrypt password hashing + signed JWT in httpOnly cookie.
// Prototype-grade. No refresh tokens / CSRF (same-site lax cookie is the gate).

import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

export type Role = "customer" | "consultant";

export type Session = {
  userId: string;
  role: Role;
  email: string;
  name: string | null;
};

const COOKIE_NAME = "zgrc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): Uint8Array {
  const raw =
    process.env.AUTH_SECRET ||
    // Fallback for local dev so things work out of the box. NOT FOR PROD.
    "dev-only-secret-change-me-in-env-AUTH_SECRET";
  return new TextEncoder().encode(raw);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.userId === "string" &&
      typeof payload.email === "string" &&
      (payload.role === "customer" || payload.role === "consultant")
    ) {
      return {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        name: (payload.name as string | null) ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(session: Session): Promise<void> {
  const token = await signSession(session);
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

/**
 * Read the session from the cookie. Returns null if missing/invalid.
 * Cached per-request so repeated calls within a render don't re-verify.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("로그인이 필요합니다.");
  return s;
}

export async function requireConsultant(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== "consultant") {
    throw new Error("컨설턴트만 수행할 수 있는 작업입니다.");
  }
  return s;
}

/**
 * Assert that the current user can modify/view the given project.
 * Consultants can access all projects; customers only their own.
 */
export async function requireProjectAccess(
  projectId: string,
): Promise<Session> {
  const s = await requireSession();
  if (s.role === "consultant") return s;
  const { prisma } = await import("@/lib/prisma");
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!p) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (p.userId !== s.userId) {
    throw new Error("이 프로젝트에 접근 권한이 없습니다.");
  }
  return s;
}
