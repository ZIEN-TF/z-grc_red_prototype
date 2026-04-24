// Simple in-memory rate limiter. Not distributed — fine for single-instance
// prototype. For production use Redis or a proper upstash/edge rate limiter.

import "server-only";

type Entry = {
  count: number;
  resetAt: number; // epoch ms
};

const buckets = new Map<string, Entry>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetInMs: number;
};

/**
 * Increment the counter for `key` and return whether we're under `limit` hits
 * within the `windowMs` window. When the window expires, the counter resets.
 * Keeps memory bounded by pruning expired entries opportunistically.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  // Opportunistic prune — avoid unbounded growth.
  if (buckets.size > 1000) {
    for (const [k, e] of buckets) {
      if (e.resetAt <= now) buckets.delete(k);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetInMs: windowMs };
  }
  existing.count++;
  const remaining = Math.max(0, limit - existing.count);
  return {
    ok: existing.count <= limit,
    remaining,
    resetInMs: existing.resetAt - now,
  };
}

/** Convenience: throw a friendly error if rate-limited. */
export function assertRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message: string = "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.",
): void {
  const res = rateLimit(key, limit, windowMs);
  if (!res.ok) {
    const mins = Math.ceil(res.resetInMs / 60000);
    throw new Error(`${message} (${mins}분 후 재시도)`);
  }
}
