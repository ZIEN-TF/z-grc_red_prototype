"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearReadNotifications,
  type NotificationItem,
} from "@/app/notification-actions";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      setUnread(await getUnreadNotificationCount());
    } catch {
      /* not logged in / transient — ignore */
    }
  }, []);

  // Initial + periodic unread-count poll. setState only runs after the async
  // fetch resolves (never synchronously in the effect body).
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const c = await getUnreadNotificationCount();
        if (active) setUnread(c);
      } catch {
        /* ignore */
      }
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        setItems(await listNotifications(20));
      } catch {
        /* ignore */
      }
    }
  }

  async function onItem(n: NotificationItem) {
    if (!n.read) {
      await markNotificationRead(n.id).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      refreshCount();
    }
    setOpen(false);
    router.push(n.linkPath || `/projects/${n.projectId}`);
  }

  async function onMarkAll() {
    await markAllNotificationsRead().catch(() => {});
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
  }

  async function onDismiss(id: string) {
    await deleteNotification(id).catch(() => {});
    setItems((prev) => prev.filter((x) => x.id !== id));
    refreshCount();
  }

  async function onClearRead() {
    await clearReadNotifications().catch(() => {});
    setItems((prev) => prev.filter((x) => !x.read));
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggle}
        aria-label="알림"
        className="relative"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">알림</span>
            <div className="flex items-center gap-2">
              <button
                onClick={onMarkAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Check className="size-3" /> 모두 읽음
              </button>
              <button
                onClick={onClearRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title="읽은 알림 정리"
              >
                <Trash2 className="size-3" /> 정리
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                알림이 없습니다.
              </p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  onClick={() => onItem(n)}
                  className={`group relative flex w-full cursor-pointer items-start gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60 ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  {!n.read && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                  <div className="min-w-0 flex-1 pr-5">
                    <p className="truncate text-xs font-medium">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(n.id);
                    }}
                    className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    aria-label="삭제"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
