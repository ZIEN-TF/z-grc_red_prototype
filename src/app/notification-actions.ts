"use server";

// UI-facing notification actions: the bell/inbox reads unread count + a recent
// list, and marks items read. All scoped to the current user.

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

export type NotificationItem = {
  id: string;
  projectId: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  read: boolean;
  createdAt: string; // ISO
};

export async function getUnreadNotificationCount(): Promise<number> {
  const s = await requireSession();
  return prisma.notification.count({
    where: { recipientUserId: s.userId, readAt: null },
  });
}

export async function listNotifications(limit = 20): Promise<NotificationItem[]> {
  const s = await requireSession();
  const rows = await prisma.notification.findMany({
    where: { recipientUserId: s.userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((n) => ({
    id: n.id,
    projectId: n.projectId,
    type: n.type,
    title: n.title,
    body: n.body,
    linkPath: n.linkPath,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(id: string): Promise<void> {
  const s = await requireSession();
  await prisma.notification.updateMany({
    where: { id, recipientUserId: s.userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  const s = await requireSession();
  await prisma.notification.updateMany({
    where: { recipientUserId: s.userId, readAt: null },
    data: { readAt: new Date() },
  });
}
