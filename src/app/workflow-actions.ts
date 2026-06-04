"use server";

// Collaboration workflow actions: confirm / reject the current stage, and
// record the customer's response to a DT-fail remediation. Each transition
// updates Project.phase and (per the state machine) starts the next AI stage
// or notifies the other side.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectAccess } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import {
  type Phase,
  type Transition,
  confirmTransition,
  rejectTransition,
  notificationCopy,
  runningStageFor,
} from "@/lib/workflow";
import { startAiPipeline } from "@/app/ai-pipeline-actions";

async function applyTransition(
  projectId: string,
  projectName: string,
  t: Transition,
  note?: string,
) {
  await prisma.project.update({
    where: { id: projectId },
    data: { phase: t.next, phaseUpdatedAt: new Date() },
  });

  if (t.notify) {
    const copy = notificationCopy(t.notifyType, projectName);
    const body =
      note && note.trim()
        ? `${copy.body}\n사유/메모: ${note.trim()}`
        : copy.body;
    await notify({
      projectId,
      to: t.notify,
      type: t.notifyType,
      title: copy.title,
      body,
      linkPath: `/projects/${projectId}`,
    });
  }

  // startAiPipeline guards on firmware presence + finalized lock; let it throw
  // to the caller if the stage can't start (the phase has already advanced to
  // *_RUNNING, and the UI surfaces the error).
  if (t.startAi) {
    // A reject carries a reason — store it so the AI re-run prompt can address
    // it ("보완해서 다시 만들어라"). Confirms have no note, so this is skipped.
    if (note && note.trim()) {
      await prisma.project.update({
        where: { id: projectId },
        data: { aiFeedbackNote: note.trim() },
      });
    }
    await startAiPipeline(projectId, t.startAi);
  }
}

export async function confirmStage(projectId: string, note?: string) {
  const session = await requireProjectAccess(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { phase: true, name: true, userId: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const phase = project.phase as Phase;
  let t = confirmTransition(phase, session.role);
  // Owner-less (legacy) project: the consultant performs the customer's turns too.
  if (!t && !project.userId && session.role === "consultant") {
    t = confirmTransition(phase, "customer");
  }
  if (!t) throw new Error("지금 단계에서 확인할 수 있는 권한이 없습니다.");
  await applyTransition(projectId, project.name, t, note);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

export async function rejectStage(projectId: string, reason: string) {
  const session = await requireProjectAccess(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { phase: true, name: true, userId: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const phase = project.phase as Phase;
  let t = rejectTransition(phase, session.role);
  if (!t && !project.userId && session.role === "consultant") {
    t = rejectTransition(phase, "customer");
  }
  if (!t) throw new Error("지금 단계에서 반려할 수 있는 권한이 없습니다.");
  await applyTransition(projectId, project.name, t, reason);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}

// Re-run the AI stage for a project stuck at a "*_RUNNING" phase (e.g. after a
// failure). Idempotent: startAiPipeline returns any in-flight run.
export async function retryAiStage(projectId: string) {
  await requireProjectAccess(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { phase: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const stage = runningStageFor(project.phase as Phase);
  if (!stage) throw new Error("지금은 다시 시도할 수 있는 단계가 아닙니다.");
  await startAiPipeline(projectId, stage);
  revalidatePath(`/projects/${projectId}`);
}

// Lightweight poll target for the workflow banner: current phase + whether the
// in-progress AI run failed (so the UI can refresh / show a retry button).
export async function getWorkflowState(
  projectId: string,
): Promise<{ phase: string; aiFailed: boolean } | null> {
  await requireProjectAccess(projectId);
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { phase: true },
  });
  if (!p) return null;
  let aiFailed = false;
  if (p.phase.endsWith("_RUNNING")) {
    const run = await prisma.aiPipelineRun.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    aiFailed = run?.status === "failed";
  }
  return { phase: p.phase, aiFailed };
}

const REMEDIATION_STATUSES = ["pending", "done", "in_progress", "not_done"];

// Customer records whether the corrective action for a DT fail was taken.
export async function saveDTRemediationResponse(input: {
  remediationId: string;
  actionStatus: string;
  customerNote: string;
}) {
  const rem = await prisma.dTRemediation.findUnique({
    where: { id: input.remediationId },
    select: { projectId: true },
  });
  if (!rem) throw new Error("조치 항목을 찾을 수 없습니다.");
  await requireProjectAccess(rem.projectId);
  const status = REMEDIATION_STATUSES.includes(input.actionStatus)
    ? input.actionStatus
    : "pending";
  await prisma.dTRemediation.update({
    where: { id: input.remediationId },
    data: {
      actionStatus: status,
      customerNote: input.customerNote ?? "",
      respondedAt: new Date(),
    },
  });
  revalidatePath(`/projects/${rem.projectId}/dt`);
}
