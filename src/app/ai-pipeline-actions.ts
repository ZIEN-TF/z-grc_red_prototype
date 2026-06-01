"use server";

// Server actions that support the /result "AI 전체 자동 수행" orchestration.
// The /result panel drives the sequence client-side (each call carries the
// session): firmware analysis → assets → DT (+instances) → evidence →
// firmware-grounded assessment. Firmware analysis is long, so it runs in the
// background and the client polls its status.

import { revalidatePath } from "next/cache";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireProjectAccess } from "@/lib/auth";
import { runFirmwareAnalysis, parseFindings, findingsToText } from "@/lib/ai/firmware";
import { callStructured } from "@/lib/ai/anthropic";
import {
  GROUNDING_INSTRUCTION,
  definitionsBlock,
  requirementGrounding,
  standardOf,
} from "@/lib/ai/standard-context";
import {
  DT_REQUIREMENTS,
  requirementById,
  assessmentsFor,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  matchAssetsForRequirement,
  getApplicableKindsFor,
  walkTree,
  type AssessmentType,
  type NodeAnswer,
  type DTNode,
  type DTBranch,
} from "@/lib/decision-trees";
import { evaluateScreening } from "@/lib/screening-questions";
import type { StandardId } from "@/lib/mechanisms";
import { kindConfig } from "@/lib/asset-kinds";
import { runAIWithAttachments, loadProjectAttachmentsForAI } from "@/lib/ai/openai";
import {
  DT_SYSTEM_PROMPT,
  buildDTUserPrompt,
  buildDTJsonSchema,
  type DTAIResult,
} from "@/lib/ai/prompts/dt";

async function assertEditable(projectId: string) {
  await requireProjectAccess(projectId);
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { finalizedAt: true },
  });
  if (p?.finalizedAt) throw new Error("확정된 프로젝트는 수정할 수 없습니다. 먼저 확정을 해제하세요.");
}

// Clear AI-generated (unreviewed) assets before a re-run so the orchestration
// is idempotent — aiFillAssets only inserts, so without this, repeated runs
// pile up duplicate assets. Cascades to their AI DT answers/evidence/assessment.
export async function resetAiGeneratedAssets(projectId: string): Promise<{ deleted: number }> {
  await assertEditable(projectId);
  const r = await prisma.asset.deleteMany({
    where: { projectId, aiGenerated: true, userReviewed: false },
  });
  revalidatePath(`/projects/${projectId}/assets`);
  revalidatePath(`/projects/${projectId}/assets/review`);
  return { deleted: r.count };
}

// ── Firmware analysis (background) ────────────────────────────────
export type FirmwareStatus = { id: string; status: string; error: string | null } | null;

export async function getFirmwareStatus(projectId: string): Promise<FirmwareStatus> {
  await requireProjectAccess(projectId);
  const fa = await prisma.firmwareAnalysis.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return fa ? { id: fa.id, status: fa.status, error: fa.error } : null;
}

// Start (or reuse) the firmware analysis. Returns immediately; the heavy work
// runs in the background on the persistent server. Poll getFirmwareStatus.
export async function startFirmwareAnalysis(projectId: string): Promise<FirmwareStatus> {
  await assertEditable(projectId);

  const fwCount = await prisma.projectAttachment.count({
    where: { projectId, kind: "firmware" },
  });
  if (fwCount === 0) throw new Error("펌웨어 첨부가 없습니다. 프로젝트 등록 시 펌웨어를 첨부하세요.");

  const done = await prisma.firmwareAnalysis.findFirst({
    where: { projectId, status: "done" },
    orderBy: { createdAt: "desc" },
  });
  if (done) return { id: done.id, status: done.status, error: done.error };

  const inflight = await prisma.firmwareAnalysis.findFirst({
    where: { projectId, status: { in: ["pending", "extracting", "analyzing"] } },
    orderBy: { createdAt: "desc" },
  });
  if (inflight) return { id: inflight.id, status: inflight.status, error: inflight.error };

  const fa = await prisma.firmwareAnalysis.create({ data: { projectId } });
  void runFirmwareAnalysis(fa.id).catch(async (err) => {
    await prisma.firmwareAnalysis
      .update({
        where: { id: fa.id },
        data: { status: "failed", error: err instanceof Error ? err.message : String(err) },
      })
      .catch(() => {});
  });
  return { id: fa.id, status: "pending", error: null };
}

// ── DT fill — ONE bundled call per requirement (all asset iterations) ──
// Replaces the per-iteration + per-node-fallback approach (which made hundreds
// of calls). Sonnet answers the whole tree for every iteration in one call;
// off-path answers are dropped server-side. Iterations the model leaves
// incomplete are simply not persisted (the user finishes those manually).
export async function aiFillDTRequirementBundled(
  projectId: string,
  requirementId: string,
): Promise<{ saved: number; iterations: number }> {
  await assertEditable(projectId);
  const req = requirementById(requirementId);
  if (!req) throw new Error(`알 수 없는 DT 요구사항: ${requirementId}`);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { assets: true, screeningAnswers: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const screening: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") screening[a.questionId] = a.answer;
  }
  const recomputed = evaluateScreening(screening);
  const applicable: StandardId[] =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ([project.applicable1 && 1, project.applicable2 && 2, project.applicable3 && 3].filter(
          Boolean,
        ) as StandardId[]);

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    metadata: safeJson(a.metadata),
  }));

  const iterations = req.iterateOver
    ? matchAssetsForRequirement(
        req,
        parsedAssets,
        getApplicableKindsFor(req, DT_REQUIREMENTS, applicable),
      ).map((a) => ({
        assetKey: a.id,
        label: `${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})`,
        metadata: a.metadata,
      }))
    : [{ assetKey: "__global__", label: "기기 전체 / Global", metadata: {} as Record<string, string> }];
  if (iterations.length === 0) return { saved: 0, iterations: 0 };

  const attachments = await loadProjectAttachmentsForAI(projectId);
  const assetSummary = parsedAssets
    .map(
      (a) =>
        `- ${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})` +
        Object.entries(a.metadata)
          .filter(([, v]) => v)
          .map(([k, v]) => ` ${k}=${v}`)
          .join(""),
    )
    .join("\n");

  const result = await runAIWithAttachments<DTAIResult>({
    systemPrompt: DT_SYSTEM_PROMPT,
    userPrompt: buildDTUserPrompt({
      project,
      requirement: req,
      iterations,
      screeningAnswers: screening,
      assetSummary,
    }),
    attachments,
    jsonSchema: buildDTJsonSchema(req, iterations.map((i) => i.assetKey)),
    schemaName: "dt_answers",
  });

  // Resolve on-path answers per iteration (drop off-path).
  const onPath = (
    answers: Array<{ nodeId: string; answer: NodeAnswer; reasoning: string }>,
  ): Array<{ nodeId: string; answer: NodeAnswer; reasoning: string }> => {
    const map = new Map(answers.filter((a) => req.nodes[a.nodeId]).map((a) => [a.nodeId, a]));
    const path: Array<{ nodeId: string; answer: NodeAnswer; reasoning: string }> = [];
    const visited = new Set<string>();
    let cur: string | undefined = req.rootNodeId;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const node: DTNode | undefined = req.nodes[cur];
      const a = map.get(cur);
      if (!node || !a) break;
      path.push(a);
      if (a.answer === "na") break;
      const branch: DTBranch = a.answer === "yes" ? node.yes : node.no;
      if ("outcome" in branch) break;
      cur = branch.goto;
    }
    return path;
  };

  // Replace unreviewed rows; preserve user-reviewed. (null assetId can't go in a
  // SQLite WHERE via the driver, so load-all + filter-in-JS + delete-by-id.)
  const allExisting = await prisma.dTAnswer.findMany({
    where: { projectId, requirementId: req.id },
    select: { id: true, assetId: true, nodeId: true, userReviewed: true },
  });
  const reviewedKeys = new Set(
    allExisting.filter((r) => r.userReviewed).map((r) => `${r.assetId ?? ""}::${r.nodeId}`),
  );
  const idsToDelete = allExisting.filter((r) => !r.userReviewed).map((r) => r.id);
  if (idsToDelete.length > 0) {
    await prisma.dTAnswer.deleteMany({ where: { id: { in: idsToDelete } } });
  }

  const validKeys = new Set(iterations.map((i) => i.assetKey));
  const now = new Date();
  const toCreate: Array<{
    projectId: string;
    assetId: string | null;
    mechanismCode: string;
    requirementId: string;
    nodeId: string;
    answer: string;
    notes: string | null;
    aiGenerated: boolean;
    aiGeneratedAt: Date;
    userReviewed: boolean;
  }> = [];
  const createdKeys = new Set<string>();
  for (const it of result.iterations) {
    if (!validKeys.has(it.assetKey)) continue;
    const assetId = it.assetKey === "__global__" ? null : it.assetKey;
    const prefix = assetId ?? "";
    for (const ans of onPath(it.answers)) {
      const key = `${prefix}::${ans.nodeId}`;
      if (reviewedKeys.has(key) || createdKeys.has(key)) continue;
      createdKeys.add(key);
      toCreate.push({
        projectId,
        assetId,
        mechanismCode: req.mechanismCode,
        requirementId: req.id,
        nodeId: ans.nodeId,
        answer: ans.answer,
        notes: ans.reasoning ?? null,
        aiGenerated: true,
        aiGeneratedAt: now,
        userReviewed: false,
      });
    }
  }
  if (toCreate.length > 0) await prisma.dTAnswer.createMany({ data: toCreate });

  revalidatePath(`/projects/${projectId}/dt/${req.id}`);
  return { saved: toCreate.length, iterations: iterations.length };
}

// ── Firmware-grounded functional assessment (#5) ──────────────────
const FwAssessmentSchema = z.object({
  assessments: z.array(
    z.object({
      type: z.enum(["completeness", "sufficiency", "conceptual_completeness"]),
      testMethod: z.string(), // 한국어, 기기별 구체 단계
      testResult: z.string(), // 한국어, 정적 분석으로 실제 확인한 결과
      verdict: z.enum(["pass", "fail", "not_applicable"]),
      aiPerformable: z.boolean(), // 실기기 동적 테스트가 반드시 필요하면 false
      evidenceText: z.string(), // 증적 파일에 저장할 본문(명령/근거/결론)
    }),
  ),
});

function safeJson(s: string): Record<string, string> {
  try {
    const o = JSON.parse(s);
    if (o && typeof o === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) out[k] = String(v);
      return out;
    }
  } catch {}
  return {};
}

// Does this requirement have at least one PASS/FAIL iteration? (mirrors the
// assessment page gating). Returns the set of asset metadata for grounding.
function requirementIsActive(
  req: (typeof DT_REQUIREMENTS)[number],
  parsedAssets: Array<{ id: string; kind: string; metadata: Record<string, string> }>,
  dtAnswers: Array<{ requirementId: string; assetId: string | null; nodeId: string; answer: string }>,
  applicable: StandardId[],
): boolean {
  const tally = (assetId: string | null): boolean => {
    if (req.naFromRequirement) {
      const linked = dtAnswers
        .filter(
          (d) =>
            d.requirementId === req.naFromRequirement!.requirementId &&
            (d.assetId ?? null) === assetId,
        )
        .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
      if (
        evaluateNAFromRequirement(req, linked, requirementById(req.naFromRequirement!.requirementId))
          .applies
      )
        return false;
    }
    const answers: Record<string, NodeAnswer> = {};
    for (const d of dtAnswers) {
      if (d.requirementId === req.id && (d.assetId ?? null) === assetId) {
        if (d.answer === "yes" || d.answer === "no" || d.answer === "na")
          answers[d.nodeId] = d.answer;
      }
    }
    if (Object.keys(answers).length === 0) return false;
    const walk = walkTree(req, answers);
    return walk.kind === "outcome" && (walk.outcome === "pass" || walk.outcome === "fail");
  };

  if (req.iterateOver) {
    const matched = matchAssetsForRequirement(
      req,
      parsedAssets,
      getApplicableKindsFor(req, DT_REQUIREMENTS, applicable),
    );
    return matched.some((a) => tally(a.id));
  }
  return tally(null);
}

export async function aiFillAssessmentFirmware(
  projectId: string,
): Promise<{ reqsProcessed: number; totalSaved: number; attached: number; errors: string[] }> {
  await assertEditable(projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { assets: true, dtAnswers: true, dtAssessments: true, screeningAnswers: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const screening: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") screening[a.questionId] = a.answer;
  }
  const recomputed = evaluateScreening(screening);
  const candidates =
    recomputed.candidateMechanisms.length > 0
      ? recomputed.candidateMechanisms
      : (JSON.parse(project.mechanismCandidates) as string[]);
  const applicable: StandardId[] =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ([project.applicable1 && 1, project.applicable2 && 2, project.applicable3 && 3].filter(
          Boolean,
        ) as StandardId[]);

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    metadata: safeJson(a.metadata),
  }));

  const fa = await prisma.firmwareAnalysis.findFirst({
    where: { projectId, status: "done" },
    orderBy: { createdAt: "desc" },
  });
  const findings = fa?.findings ? parseFindings(fa.findings) : null;
  // Cap injected findings — large inputs slow every call and risk gateway timeouts.
  const findingsText = findings
    ? findingsToText(findings).slice(0, 8000)
    : "(펌웨어 분석 결과 없음)";

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.some((s) => applicable.includes(s)) &&
      evaluateRequirementApplicability(r, screening).applies &&
      assessmentsFor(r.id).length > 0,
  );

  const errors: string[] = [];
  let reqsProcessed = 0;
  let totalSaved = 0;
  let attached = 0;
  const now = new Date();

  for (const req of visibleReqs) {
    try {
      if (!requirementIsActive(req, parsedAssets, project.dtAnswers, applicable)) continue;
      const types = assessmentsFor(req.id);
      const std = standardOf(req.id);

      const system = [
        GROUNDING_INSTRUCTION,
        "# 펌웨어 정적 분석 결과 (binwalk 추출 파일시스템)\n" + findingsText,
        definitionsBlock(std),
      ].join("\n\n");

      const res = await callStructured({
        system,
        user:
          requirementGrounding(req.id, types) +
          "\n\n## 작업\n아래 평가 유형 각각에 대해, **펌웨어 정적 분석 결과**와 assessment unit을 근거로 평가를 수행하라.\n" +
          `평가 유형: ${types.join(", ")}.\n` +
          "- testMethod: 이 기기에 맞는 구체적 테스트 방법(한국어).\n" +
          "- testResult: 정적 분석으로 **실제 확인한 결과**(한국어). 펌웨어로 판단 가능한 것은 최대한 직접 판정하라.\n" +
          "- verdict: 판정 기준(Assignment of verdict)을 적용해 pass/fail/not_applicable.\n" +
          "- aiPerformable: **실기기 구동·네트워크 동작·하드웨어가 반드시 필요한 경우에만 false**. 펌웨어 정적 분석/문서로 판단 가능하면 true로 하고 직접 수행하라(사람 테스트를 최소화하는 것이 목표).\n" +
          "- evidenceText: 증적 파일에 저장할 본문(한국어). 어떤 파일/명령/근거로 확인했는지, 발견 내용, 결론을 적어라.\n" +
          "모든 출력은 한국어로 작성하라.",
        schema: FwAssessmentSchema,
        schemaName: "fw_assessment",
        effort: "medium",
        maxTokens: 9000,
      });

      const validTypes = new Set<AssessmentType>(types);
      for (const a of res.assessments) {
        if (!validTypes.has(a.type as AssessmentType)) continue;

        const existing = await prisma.dTAssessment.findFirst({
          where: { projectId, assetId: null, requirementId: req.id, assessmentType: a.type },
        });
        if (existing?.userReviewed) continue;

        let testResult = a.testResult?.trim() ?? "";
        if (!a.aiPerformable) {
          testResult = `AI 수행 불가 — 실기기 동적 테스트 필요.\n${testResult}`.trim();
        }

        // Write the AI-generated evidence as a .txt and attach it (only when
        // the AI actually performed the check).
        let attach: {
          attachmentFilename: string;
          attachmentStoredPath: string;
          attachmentMimeType: string;
          attachmentSize: number;
        } | null = null;
        if (a.aiPerformable && a.evidenceText?.trim()) {
          const dir = path.join(process.cwd(), "uploads", projectId, "assessments");
          await fs.mkdir(dir, { recursive: true });
          const filename = `${req.id}-${a.type}-evidence.txt`.replace(/[^\w.\-]/g, "_");
          const storedPath = path.posix.join(
            projectId,
            "assessments",
            `${crypto.randomUUID()}-${filename}`,
          );
          const full = path.join(process.cwd(), "uploads", storedPath);
          const body = `# ${req.id} — ${a.type} 증적 (AI 자동 생성)\n\n## 테스트 방법\n${a.testMethod}\n\n## 테스트 결과\n${testResult}\n\n## 근거\n${a.evidenceText}\n`;
          await fs.writeFile(full, body, "utf8");
          attach = {
            attachmentFilename: filename,
            attachmentStoredPath: storedPath,
            attachmentMimeType: "text/plain",
            attachmentSize: Buffer.byteLength(body),
          };
          attached++;
        }

        const data = {
          testMethod: a.testMethod?.trim() ?? "",
          testResult,
          verdict: a.aiPerformable ? a.verdict : null,
          aiGenerated: true,
          aiGeneratedAt: now,
          ...(attach ?? {}),
        };
        if (existing) {
          await prisma.dTAssessment.update({ where: { id: existing.id }, data });
        } else {
          await prisma.dTAssessment.create({
            data: { projectId, assetId: null, requirementId: req.id, assessmentType: a.type, ...data },
          });
        }
        totalSaved++;
      }
      reqsProcessed++;
    } catch (err) {
      errors.push(`${req.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  revalidatePath(`/projects/${projectId}/assessment`, "layout");
  return { reqsProcessed, totalSaved, attached, errors };
}
