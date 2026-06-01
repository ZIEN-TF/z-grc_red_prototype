// Background runner for "AI 전체 자동 수행". Detached job (started by
// startAiPipeline) — no HTTP request, so no gateway timeout, and it survives
// the user closing the tab. Progress is written to AiPipelineRun; the client
// polls getAiPipelineStatus.
//
// All steps run inside bgAuth.run({projectId}) so the mature fill actions'
// session guards pass (see bg-context.ts). This is plain server code (NOT a
// "use server" module) so it can call the fill actions as functions.

import { bgAuth } from "./bg-context";
import { prisma } from "@/lib/prisma";
import { runFirmwareAnalysis } from "./firmware";
import { aiFillAssets, aiFillDTInit, aiFillEvidenceAll } from "@/app/ai-actions";
import {
  resetAiGeneratedAssets,
  aiFillDTRequirementBundled,
  aiFillAssessmentFirmware,
} from "@/app/ai-pipeline-actions";

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function setStep(runId: string, step: string, total: number, message: string) {
  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { step, total, completed: 0, message },
  });
}

async function addErr(runId: string, line: string) {
  const run = await prisma.aiPipelineRun.findUnique({ where: { id: runId } });
  const prev = run?.error ?? "";
  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { error: (prev ? prev + "\n" : "") + line },
  });
}

// Run a step, swallowing errors (incl. revalidatePath called outside a request,
// which throws AFTER the DB writes succeed — so data is safe) into the run log.
async function safe(runId: string, label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    await addErr(runId, `${label}: ${msg(err)}`);
  }
}

export async function runFullPipeline(runId: string): Promise<void> {
  const run = await prisma.aiPipelineRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const projectId = run.projectId;

  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { status: "running", startedAt: new Date(), step: "firmware", message: "펌웨어 분석 준비 중…" },
  });

  await bgAuth.run({ projectId }, async () => {
    try {
      // 1) Firmware analysis (once; reuse if already done).
      const done = await prisma.firmwareAnalysis.findFirst({
        where: { projectId, status: "done" },
        orderBy: { createdAt: "desc" },
      });
      if (!done) {
        await setStep(runId, "firmware", 1, "펌웨어 추출·분석 중 (binwalk)…");
        const fa = await prisma.firmwareAnalysis.create({ data: { projectId } });
        await runFirmwareAnalysis(fa.id);
      }

      // 2) Assets — clear prior AI assets, then identify.
      await setStep(runId, "assets", 1, "이전 AI 자산 정리 후 식별 중…");
      await safe(runId, "reset", () => resetAiGeneratedAssets(projectId));
      await safe(runId, "assets", () => aiFillAssets(projectId));

      // 3) DT — instance creation + one bundled call per requirement.
      await setStep(runId, "dt", 1, "Decision Tree 준비 중 (인스턴스 생성)…");
      let reqIds: string[] = [];
      try {
        const init = await aiFillDTInit(projectId);
        reqIds = init.requirementIds;
      } catch (err) {
        await addErr(runId, `DT init: ${msg(err)}`);
      }
      await prisma.aiPipelineRun.update({
        where: { id: runId },
        data: { total: reqIds.length, completed: 0 },
      });
      for (let i = 0; i < reqIds.length; i++) {
        await prisma.aiPipelineRun.update({
          where: { id: runId },
          data: { completed: i, message: `DT 평가 ${reqIds[i]}` },
        });
        await safe(runId, `DT ${reqIds[i]}`, () => aiFillDTRequirementBundled(projectId, reqIds[i]));
      }

      // 4) Evidence (required information).
      await setStep(runId, "evidence", 1, "증빙 정보 채우는 중…");
      await safe(runId, "evidence", () => aiFillEvidenceAll(projectId));

      // 5) Firmware-grounded functional assessment (+ evidence files).
      await setStep(runId, "assessment", 1, "기능 평가 수행 + 증적 생성 중…");
      await safe(runId, "assessment", () => aiFillAssessmentFirmware(projectId));

      await prisma.aiPipelineRun.update({
        where: { id: runId },
        data: { status: "done", step: "done", message: "완료", finishedAt: new Date() },
      });
    } catch (err) {
      await prisma.aiPipelineRun
        .update({
          where: { id: runId },
          data: { status: "failed", error: msg(err), finishedAt: new Date() },
        })
        .catch(() => {});
    }
  });
}
