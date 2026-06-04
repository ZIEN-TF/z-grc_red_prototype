// In-app notification fan-out. A workflow event targets a "side" of the
// project; we expand that to concrete recipient users (one Notification row
// each) so unread state is per-user even for "all consultants" events.
//
// Server-only — uses prisma directly. Called by workflow transitions and the
// background pipeline runner.

import "server-only";
import { prisma } from "@/lib/prisma";
import type { WorkflowRole } from "@/lib/workflow";

export async function notify(opts: {
  projectId: string;
  to: WorkflowRole; // "customer" → project owner; "consultant" → all consultants
  type: string;
  title: string;
  body?: string;
  linkPath?: string;
}): Promise<number> {
  const recipientIds: string[] = [];
  if (opts.to === "consultant") {
    const consultants = await prisma.user.findMany({
      where: { role: "consultant" },
      select: { id: true },
    });
    recipientIds.push(...consultants.map((c) => c.id));
  } else {
    const project = await prisma.project.findUnique({
      where: { id: opts.projectId },
      select: { userId: true },
    });
    if (project?.userId) recipientIds.push(project.userId);
  }
  if (recipientIds.length === 0) return 0;

  await prisma.notification.createMany({
    data: recipientIds.map((rid) => ({
      projectId: opts.projectId,
      recipientUserId: rid,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? "",
      linkPath: opts.linkPath ?? null,
    })),
  });
  return recipientIds.length;
}
