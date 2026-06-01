// Background authorization context.
//
// The "AI 전체 자동 수행" pipeline runs as a detached background job (no HTTP
// request → no session). The mature fill actions guard on a session, which a
// background job can't provide. This AsyncLocalStorage lets the background
// runner mark "this project is already authorized" so those guards can pass.
//
// SECURITY: only server code (the background runner) ever calls bgAuth.run().
// A client HTTP request never goes through it, so getStore() is undefined for
// client calls — they still hit the normal session guard. There is no way for
// a client to set this context.

import { AsyncLocalStorage } from "node:async_hooks";

export const bgAuth = new AsyncLocalStorage<{ projectId: string }>();

export function isBackgroundAuthorized(projectId: string): boolean {
  return bgAuth.getStore()?.projectId === projectId;
}
