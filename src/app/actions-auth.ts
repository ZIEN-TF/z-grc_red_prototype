"use server";

import crypto from "crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  type Role,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export type AuthResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

// Hash the raw token before storing so DB leaks don't hand out reset powers.
function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function signupAction(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const name = input.name?.trim() || null;

  if (!email || !password) {
    return { ok: false, error: "이메일과 비밀번호는 필수입니다." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "올바른 이메일 형식이 아닙니다." };
  }
  if (password.length < 6) {
    return { ok: false, error: "비밀번호는 최소 6자 이상이어야 합니다." };
  }

  // Rate limit: 5 signups per email per hour (prevents automated abuse)
  const rl = rateLimit(`signup:${email}`, 5, 60 * 60 * 1000);
  if (!rl.ok) {
    return {
      ok: false,
      error: `가입 시도가 너무 잦습니다. ${Math.ceil(rl.resetInMs / 60000)}분 후 다시 시도하세요.`,
    };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: "이미 사용 중인 이메일입니다." };
  }

  // First user in the system becomes the consultant automatically (bootstrap).
  const userCount = await prisma.user.count();
  const role: Role = userCount === 0 ? "consultant" : "customer";

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role },
  });

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    role: user.role as Role,
    name: user.name,
  });

  return { ok: true, redirectTo: "/" };
}

export async function loginAction(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    return { ok: false, error: "이메일과 비밀번호를 입력하세요." };
  }

  // Rate limit: 5 failed attempts per email per 15 minutes.
  // We increment on every attempt (including successful). Successful attempts
  // are trivially rare, so the impact on legitimate users is negligible.
  const rl = rateLimit(`login:${email}`, 5, 15 * 60 * 1000);
  if (!rl.ok) {
    return {
      ok: false,
      error: `로그인 시도가 너무 잦습니다. ${Math.ceil(rl.resetInMs / 60000)}분 후 다시 시도하세요.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다." };
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return { ok: false, error: "이메일 또는 비밀번호가 일치하지 않습니다." };
  }

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    role: user.role as Role,
    name: user.name,
  });

  return { ok: true, redirectTo: "/" };
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}

// ── Password reset ────────────────────────────────────────────────
// Prototype mode: we return the reset URL to the client instead of emailing
// it. In production this URL would be sent via SMTP and never exposed to
// the requester.

export type RequestResetResult =
  | { ok: true; resetUrl: string | null }
  | { ok: false; error: string };

export async function requestPasswordReset(input: {
  email: string;
}): Promise<RequestResetResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "이메일을 입력하세요." };

  // Rate limit: 3 per email per hour
  const rl = rateLimit(`reset:${email}`, 3, 60 * 60 * 1000);
  if (!rl.ok) {
    return {
      ok: false,
      error: `재설정 요청이 너무 잦습니다. ${Math.ceil(rl.resetInMs / 60000)}분 후 다시 시도하세요.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Return ok even if not found (avoid email enumeration), but no URL.
    return { ok: true, resetUrl: null };
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Invalidate any existing unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  // Construct URL. In production use the public origin from env.
  const resetUrl = `/reset-password?token=${rawToken}`;
  return { ok: true, resetUrl };
}

export type ConfirmResetResult =
  | { ok: true }
  | { ok: false; error: string };

export async function confirmPasswordReset(input: {
  token: string;
  newPassword: string;
}): Promise<ConfirmResetResult> {
  const token = input.token.trim();
  if (!token) return { ok: false, error: "재설정 토큰이 없습니다." };
  if (input.newPassword.length < 6) {
    return { ok: false, error: "비밀번호는 최소 6자 이상이어야 합니다." };
  }

  // Rate limit: 10 confirm attempts per token in 15 min (per-token bucket)
  const rl = rateLimit(`reset-confirm:${token}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return { ok: false, error: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요." };
  }

  const tokenHash = sha256(token);
  const rec = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!rec) {
    return { ok: false, error: "유효하지 않은 링크입니다." };
  }
  if (rec.usedAt) {
    return { ok: false, error: "이미 사용된 링크입니다." };
  }
  if (rec.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "만료된 링크입니다. 다시 요청해 주세요." };
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: rec.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: rec.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate any other unused tokens for the same user
    prisma.passwordResetToken.updateMany({
      where: { userId: rec.userId, usedAt: null, id: { not: rec.id } },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true };
}
