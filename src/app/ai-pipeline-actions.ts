"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectAccess } from "@/lib/auth";
import { runPipeline } from "@/lib/ai/pipeline";

export type PipelineStatus = {
  id: string;
  status: string; // queued|running|done|failed|canceled
  step: string;
  total: number;
  completed: number;
  message: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
} | null;

function serialize(run: {
  id: string;
  status: string;
  step: string;
  total: number;
  completed: number;
  message: string;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}): PipelineStatus {
  return {
    id: run.id,
    status: run.status,
    step: run.step,
    total: run.total,
    completed: run.completed,
    message: run.message,
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

// Latest pipeline run for a project (for initial render + polling).
export async function getAiPipelineStatus(projectId: string): Promise<PipelineStatus> {
  await requireProjectAccess(projectId);
  const run = await prisma.aiPipelineRun.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return run ? serialize(run) : null;
}

// Start the background pipeline. No-op (returns the existing run) if one is
// already running for this project.
export async function startAiPipeline(projectId: string): Promise<PipelineStatus> {
  await requireProjectAccess(projectId);

  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { screeningComplete: true, finalizedAt: true },
  });
  if (!p?.screeningComplete) throw new Error("스크리닝을 먼저 완료하세요.");
  if (p.finalizedAt) throw new Error("확정된 프로젝트는 자동 수행할 수 없습니다. 먼저 확정을 해제하세요.");

  const inflight = await prisma.aiPipelineRun.findFirst({
    where: { projectId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (inflight) return serialize(inflight);

  const run = await prisma.aiPipelineRun.create({
    data: { projectId, status: "queued", message: "대기 중…" },
  });

  // Fire-and-forget: the app runs as a persistent Node process (pm2 next start),
  // so the promise continues after this action returns. The UI polls status.
  void runPipeline(run.id).catch(() => {});

  revalidatePath(`/projects/${projectId}/result`);
  return serialize(run);
}
