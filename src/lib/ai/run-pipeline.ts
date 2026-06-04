// Background runner for the AI auto-fill pipeline. Detached job (started by
// startAiPipeline) — no HTTP request, so no gateway timeout, and it survives
// the user closing the tab. Progress is written to AiPipelineRun; the client
// polls getAiPipelineStatus.
//
// A run covers one flow "stage":
//   - "assets"     : firmware analysis + asset identification
//   - "dt"         : DT answers + evidence + DT-fail remediation
//   - "assessment" : functional-assessment testMethod (only)
//   - "full"       : all of the above in sequence (legacy one-shot run)
//
// The stages are gated by the collaboration workflow (a consultant confirm
// triggers the next stage), so they run separately rather than all at once.
//
// All steps run inside bgAuth.run({projectId}) so the fill actions' session
// guards pass (see bg-context.ts). This is plain server code (NOT a
// "use server" module) so it can call the fill actions as functions.

import { bgAuth } from "./bg-context";
import { prisma } from "@/lib/prisma";
import { runFirmwareAnalysis } from "./firmware";
import { aiFillAssets, aiFillDTInit, aiFillEvidenceAll } from "@/app/ai-actions";
import {
  resetAiGeneratedAssets,
  aiFillDTRequirementBundled,
  aiFillAssessmentFirmware,
  aiFillDTRemediations,
} from "@/app/ai-pipeline-actions";
import { AI_DONE_TRANSITION, notificationCopy, type GatedAiStage } from "@/lib/workflow";
import { notify } from "@/lib/notifications";
import { isAiMock, mockAssets, mockDt, mockAssessment } from "./mock-fill";

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

// Firmware analysis is shared by every stage (downstream fills reuse its
// findings). Run it once; reuse if already done.
async function ensureFirmware(runId: string, projectId: string) {
  const done = await prisma.firmwareAnalysis.findFirst({
    where: { projectId, status: "done" },
    orderBy: { createdAt: "desc" },
  });
  if (!done) {
    await setStep(runId, "firmware", 1, "펌웨어 추출·분석 중 (binwalk)…");
    const fa = await prisma.firmwareAnalysis.create({ data: { projectId } });
    await runFirmwareAnalysis(fa.id);
  }
}

// Stage: assets — clear prior AI assets, then identify from firmware/documents.
async function runAssetsSegment(runId: string, projectId: string) {
  if (isAiMock()) {
    await setStep(runId, "assets", 1, "[테스트] 가상 자산 생성 중…");
    await safe(runId, "mock-assets", () => mockAssets(projectId));
    return;
  }
  await setStep(runId, "assets", 1, "이전 AI 자산 정리 후 식별 중…");
  await safe(runId, "reset", () => resetAiGeneratedAssets(projectId));
  await safe(runId, "assets", () => aiFillAssets(projectId));
}

// Stage: dt — DT instances + one bundled call per requirement, then evidence,
// then a remediation plan for every requirement×asset that evaluated to FAIL.
async function runDtSegment(runId: string, projectId: string) {
  if (isAiMock()) {
    await setStep(runId, "dt", 1, "[테스트] 가상 DT·조치방안 생성 중…");
    await safe(runId, "mock-dt", () => mockDt(projectId));
    return;
  }
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

  await setStep(runId, "evidence", 1, "증빙 정보 채우는 중…");
  await safe(runId, "evidence", () => aiFillEvidenceAll(projectId));

  await setStep(runId, "remediation", 1, "부적합(FAIL) 항목 조치 방안 작성 중…");
  await safe(runId, "remediation", () => aiFillDTRemediations(projectId));
}

// Stage: assessment — AI fills the testMethod only; the consultant fills the
// test result + verdict by hand.
async function runAssessmentSegment(runId: string, projectId: string) {
  if (isAiMock()) {
    await setStep(runId, "assessment", 1, "[테스트] 가상 테스트 방법 생성 중…");
    await safe(runId, "mock-assessment", () => mockAssessment(projectId));
    return;
  }
  await setStep(runId, "assessment", 1, "기능 평가 테스트 방법 작성 중…");
  await safe(runId, "assessment", () => aiFillAssessmentFirmware(projectId));
}

export async function runPipeline(runId: string): Promise<void> {
  const run = await prisma.aiPipelineRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const projectId = run.projectId;
  const stage = run.stage || "full";

  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { status: "running", startedAt: new Date(), step: "firmware", message: "준비 중…" },
  });

  await bgAuth.run({ projectId }, async () => {
    try {
      // Mock mode skips the heavy binwalk firmware analysis entirely.
      if (!isAiMock()) await ensureFirmware(runId, projectId);
      if (stage === "full" || stage === "assets") await runAssetsSegment(runId, projectId);
      if (stage === "full" || stage === "dt") await runDtSegment(runId, projectId);
      if (stage === "full" || stage === "assessment") await runAssessmentSegment(runId, projectId);

      // Advance the collaboration workflow + notify the next party, but only
      // for a gated single-stage run still sitting at the matching *_RUNNING
      // phase (the legacy "full" run doesn't drive the workflow).
      if (stage !== "full") {
        const tr = AI_DONE_TRANSITION[stage as GatedAiStage];
        if (tr) {
          const proj = await prisma.project.findUnique({
            where: { id: projectId },
            select: { phase: true, name: true },
          });
          if (proj && proj.phase === tr.from) {
            await prisma.project.update({
              where: { id: projectId },
              data: { phase: tr.next, phaseUpdatedAt: new Date() },
            });
            const copy = notificationCopy(tr.notifyType, proj.name);
            await notify({
              projectId,
              to: tr.notify,
              type: tr.notifyType,
              title: copy.title,
              body: copy.body,
              linkPath: `/projects/${projectId}`,
            });
          }
        }
      }

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

// Backward-compatible alias — delegates to runPipeline (honoring run.stage).
export async function runFullPipeline(runId: string): Promise<void> {
  return runPipeline(runId);
}
