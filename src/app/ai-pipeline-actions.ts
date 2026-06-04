"use server";

// Server actions that support the /result "AI 전체 자동 수행" orchestration.
// The /result panel drives the sequence client-side (each call carries the
// session): firmware analysis → assets → DT (+instances) → evidence →
// firmware-grounded assessment. Firmware analysis is long, so it runs in the
// background and the client polls its status.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectAccess } from "@/lib/auth";
import { isBackgroundAuthorized } from "@/lib/ai/bg-context";
import { runFirmwareAnalysis } from "@/lib/ai/firmware";
import { isAiMock } from "@/lib/ai/mock-fill";
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
  // Authorized background pipeline run skips the session check (see bg-context.ts),
  // but the finalized-project lock still applies.
  if (!isBackgroundAuthorized(projectId)) await requireProjectAccess(projectId);
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { finalizedAt: true },
  });
  if (p?.finalizedAt) throw new Error("확정된 프로젝트는 수정할 수 없습니다. 먼저 확정을 해제하세요.");
}

// ── Pipeline run: start (background) + status (poll) ───────────────
// A run covers one flow segment ("stage"): "assets", "dt", or "assessment"
// (or "full" for the legacy one-shot run).
export type AiStage = "full" | "assets" | "dt" | "assessment";

export type AiRunStatus = {
  id: string;
  stage: string; // full|assets|dt|assessment
  status: string; // queued|running|done|failed
  step: string; // firmware|assets|dt|evidence|remediation|assessment|done
  total: number;
  completed: number;
  message: string;
  error: string | null;
} | null;

function serializeRun(run: {
  id: string;
  stage: string;
  status: string;
  step: string;
  total: number;
  completed: number;
  message: string;
  error: string | null;
}): AiRunStatus {
  return {
    id: run.id,
    stage: run.stage,
    status: run.status,
    step: run.step,
    total: run.total,
    completed: run.completed,
    message: run.message,
    error: run.error,
  };
}

export async function getAiPipelineStatus(projectId: string): Promise<AiRunStatus> {
  await requireProjectAccess(projectId);
  const run = await prisma.aiPipelineRun.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return run ? serializeRun(run) : null;
}

// Start one pipeline stage as a background job. Returns immediately; the client
// polls getAiPipelineStatus. No long blocking request → no gateway timeout, and
// the run survives the user closing the tab. `stage` selects which flow segment
// runs ("assets" / "dt" / "assessment"); "full" keeps the legacy one-shot run.
export async function startAiPipeline(
  projectId: string,
  stage: AiStage = "full",
): Promise<AiRunStatus> {
  await assertEditable(projectId);
  // Mock mode doesn't need firmware (it inserts placeholder data instead).
  if (!isAiMock()) {
    const fwCount = await prisma.projectAttachment.count({
      where: { projectId, kind: "firmware" },
    });
    if (fwCount === 0) throw new Error("펌웨어 첨부가 없습니다. 프로젝트 등록 시 펌웨어를 첨부하세요.");
  }

  const inflight = await prisma.aiPipelineRun.findFirst({
    where: { projectId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
  });
  if (inflight) {
    const stale = Date.now() - inflight.updatedAt.getTime() > 30 * 60 * 1000;
    if (!stale) return serializeRun(inflight);
    await prisma.aiPipelineRun.update({
      where: { id: inflight.id },
      data: { status: "failed", error: "중단됨(서버 재시작 추정)", finishedAt: new Date() },
    });
  }

  const run = await prisma.aiPipelineRun.create({
    data: { projectId, stage, status: "queued", message: "대기 중…" },
  });
  // Dynamic import avoids a static import cycle with run-pipeline.ts.
  const { runPipeline } = await import("@/lib/ai/run-pipeline");
  void runPipeline(run.id).catch(() => {});
  revalidatePath(`/projects/${projectId}/result`);
  return serializeRun(run);
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

  // Reflect the customer's reject reason (if any) into the re-run prompt.
  const feedbackBlock = project.aiFeedbackNote?.trim()
    ? `\n\n## 고객 보완 요청 (이전 결과 반려 사유)\n${project.aiFeedbackNote.trim()}\n위 피드백을 반영하여 평가를 보완하라.`
    : "";

  const result = await runAIWithAttachments<DTAIResult>({
    systemPrompt: DT_SYSTEM_PROMPT,
    userPrompt:
      buildDTUserPrompt({
        project,
        requirement: req,
        iterations,
        screeningAnswers: screening,
        assetSummary,
      }) + feedbackBlock,
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

// ── Functional assessment + DT-fail remediation ───────────────────
// Both are AI fills grounded on the firmware findings + uploaded documents
// (loadProjectAttachmentsForAI bundles both). All AI output is Korean.

// Derive screening map / candidate mechanisms / applicable standards the same
// way the DT and assessment fills do. Shared by the assessment + remediation
// fills below.
function deriveScreeningContext(project: {
  screeningAnswers: Array<{ questionId: string; answer: string }>;
  applicable1: boolean;
  applicable2: boolean;
  applicable3: boolean;
  mechanismCandidates: string;
}): {
  screening: Record<string, "yes" | "no">;
  candidates: string[];
  applicable: StandardId[];
} {
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
  return { screening, candidates, applicable };
}

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

// Outcome of one DT iteration (asset or global) for a requirement, as a leaf
// outcome string ("pass" | "fail" | "not_applicable") or null if unresolved.
// Mirrors requirementIsActive's tally but exposes the actual outcome.
function iterationOutcome(
  req: (typeof DT_REQUIREMENTS)[number],
  assetId: string | null,
  dtAnswers: Array<{
    requirementId: string;
    assetId: string | null;
    nodeId: string;
    answer: string;
  }>,
): string | null {
  if (req.naFromRequirement) {
    const linked = dtAnswers
      .filter(
        (d) =>
          d.requirementId === req.naFromRequirement!.requirementId &&
          (d.assetId ?? null) === assetId,
      )
      .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
    if (
      evaluateNAFromRequirement(
        req,
        linked,
        requirementById(req.naFromRequirement!.requirementId),
      ).applies
    )
      return "not_applicable";
  }
  const answers: Record<string, NodeAnswer> = {};
  for (const d of dtAnswers) {
    if (d.requirementId === req.id && (d.assetId ?? null) === assetId) {
      if (d.answer === "yes" || d.answer === "no" || d.answer === "na")
        answers[d.nodeId] = d.answer;
    }
  }
  if (Object.keys(answers).length === 0) return null;
  const walk = walkTree(req, answers);
  return walk.kind === "outcome" ? walk.outcome : null;
}

// ── #5 Functional assessment — AI fills testMethod ONLY ────────────
// The AI proposes the 테스트 방법(test method) for each assessment unit; the
// human consultant fills the 테스트 결과(test result) + verdict. Grounded on the
// firmware findings + uploaded documents. All AI output is Korean.
export async function aiFillAssessmentFirmware(
  projectId: string,
): Promise<{ reqsProcessed: number; totalSaved: number; errors: string[] }> {
  await assertEditable(projectId);

  // Mock mode: insert placeholder testMethods instead of calling the API.
  if (isAiMock()) {
    const { mockAssessment } = await import("@/lib/ai/mock-fill");
    await mockAssessment(projectId);
    revalidatePath(`/projects/${projectId}/assessment`, "layout");
    return { reqsProcessed: 0, totalSaved: 0, errors: [] };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { assets: true, dtAnswers: true, dtAssessments: true, screeningAnswers: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const { screening, candidates, applicable } = deriveScreeningContext(project);

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    metadata: safeJson(a.metadata),
  }));

  // Firmware findings + uploaded documents (loadProjectAttachmentsForAI appends
  // the firmware analysis as a text block), so testMethod is grounded in both.
  const attachments = await loadProjectAttachmentsForAI(projectId);

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
  const now = new Date();

  for (const req of visibleReqs) {
    try {
      if (!requirementIsActive(req, parsedAssets, project.dtAnswers, applicable)) continue;
      const types = assessmentsFor(req.id);
      const std = standardOf(req.id);

      const systemPrompt = [
        GROUNDING_INSTRUCTION,
        definitionsBlock(std),
        "위 정의와 함께, 첨부된 사용자 문서·펌웨어 정적 분석 결과를 근거로 작업한다. 모든 출력은 반드시 한국어로 작성한다.",
      ].join("\n\n");

      const userPrompt =
        (requirementGrounding(req.id, types) ?? "") +
        "\n\n## 작업\n" +
        "아래 평가 유형 각각에 대해, 이 기기에 맞는 구체적인 **테스트 방법(testMethod)** 만 작성하라.\n" +
        `평가 유형: ${types.join(", ")}.\n` +
        "- testMethod: 어떤 파일·설정·로그·문서를 어떤 순서로 확인하여 이 요구사항 충족 여부를 검증할지, 이 기기에 맞춰 구체적으로 적어라.\n" +
        "- 테스트 결과와 합부 판정(verdict)은 사람이 직접 수행하므로 **절대 작성하지 말 것**.\n" +
        "모든 출력은 반드시 한국어로 작성하라.";

      const res = await runAIWithAttachments<{
        assessments: Array<{ type: string; testMethod: string }>;
      }>({
        systemPrompt,
        userPrompt,
        attachments,
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            assessments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: { type: "string", enum: types },
                  testMethod: { type: "string" },
                },
                required: ["type", "testMethod"],
              },
            },
          },
          required: ["assessments"],
        },
        schemaName: "assessment_method",
      });

      const validTypes = new Set<AssessmentType>(types);
      for (const a of res.assessments) {
        if (!validTypes.has(a.type as AssessmentType)) continue;
        const testMethod = a.testMethod?.trim() ?? "";
        if (!testMethod) continue;

        const existing = await prisma.dTAssessment.findFirst({
          where: { projectId, assetId: null, requirementId: req.id, assessmentType: a.type },
        });
        if (existing?.userReviewed) continue;

        if (existing) {
          // Update only the AI-owned testMethod; leave the human-owned
          // testResult/verdict untouched.
          await prisma.dTAssessment.update({
            where: { id: existing.id },
            data: { testMethod, aiGenerated: true, aiGeneratedAt: now },
          });
        } else {
          await prisma.dTAssessment.create({
            data: {
              projectId,
              assetId: null,
              requirementId: req.id,
              assessmentType: a.type,
              testMethod,
              aiGenerated: true,
              aiGeneratedAt: now,
            },
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
  return { reqsProcessed, totalSaved, errors };
}

// ── DT fail → 조치 방안(remediation) generation ────────────────────
// For every requirement×asset DT iteration that resolved to FAIL, ask the AI
// for a concrete corrective-action plan (Korean), grounded on the firmware +
// documents. Upserts into DTRemediation, preserving any customer response, and
// prunes AI remediations for fails that have since been resolved (and that the
// customer hasn't responded to).
export async function aiFillDTRemediations(
  projectId: string,
): Promise<{ reqsProcessed: number; fails: number; saved: number; errors: string[] }> {
  await assertEditable(projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { assets: true, dtAnswers: true, screeningAnswers: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const { screening, candidates, applicable } = deriveScreeningContext(project);

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    metadata: safeJson(a.metadata),
  }));

  const attachments = await loadProjectAttachmentsForAI(projectId);

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.some((s) => applicable.includes(s)) &&
      evaluateRequirementApplicability(r, screening).applies,
  );

  const errors: string[] = [];
  let reqsProcessed = 0;
  let fails = 0;
  let saved = 0;
  const now = new Date();
  const liveKeys = new Set<string>();
  const keyOf = (assetId: string | null, reqId: string) => `${assetId ?? ""}::${reqId}`;

  for (const req of visibleReqs) {
    try {
      const iters: Array<{
        assetKey: string;
        assetId: string | null;
        label: string;
        metadata: Record<string, string>;
      }> = req.iterateOver
        ? matchAssetsForRequirement(
            req,
            parsedAssets,
            getApplicableKindsFor(req, DT_REQUIREMENTS, applicable),
          ).map((a) => ({
            assetKey: a.id,
            assetId: a.id,
            label: `${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})`,
            metadata: a.metadata,
          }))
        : [{ assetKey: "__global__", assetId: null, label: "기기 전체 / Global", metadata: {} }];

      const failing = iters.filter(
        (it) => iterationOutcome(req, it.assetId, project.dtAnswers) === "fail",
      );
      if (failing.length === 0) continue;
      fails += failing.length;
      reqsProcessed++;
      for (const f of failing) liveKeys.add(keyOf(f.assetId, req.id));

      const std = standardOf(req.id);
      const systemPrompt = [
        GROUNDING_INSTRUCTION,
        definitionsBlock(std),
        "위 정의와 함께, 첨부된 사용자 문서·펌웨어 정적 분석 결과를 근거로 작업한다. 모든 출력은 반드시 한국어로 작성한다.",
      ].join("\n\n");

      const failBlock = failing
        .map(
          (f, i) =>
            `${i + 1}. assetKey="${f.assetKey}" — ${f.label}` +
            Object.entries(f.metadata)
              .filter(([, v]) => v)
              .map(([k, v]) => `\n   - ${k}: ${v}`)
              .join(""),
        )
        .join("\n");

      const userPrompt =
        (requirementGrounding(req.id, assessmentsFor(req.id)) ?? "") +
        "\n\n## 상황\n" +
        `아래 평가 단위들은 요구사항 ${req.id}의 Decision Tree 평가 결과가 **부적합(FAIL)** 으로 판정되었다.\n` +
        failBlock +
        "\n\n## 작업\n" +
        "각 평가 단위(assetKey)에 대해, 이 요구사항을 충족시키기 위한 **구체적인 조치 방안(remediationText)** 을 한국어로 작성하라.\n" +
        "- 무엇이 미충족인지, 어떤 설정·구현·문서를 어떻게 바꿔야 하는지 실무적으로 적어라.\n" +
        "- 가능하면 펌웨어/문서에서 확인된 근거를 인용하라.\n" +
        "모든 출력은 반드시 한국어로 작성하라.";

      const res = await runAIWithAttachments<{
        remediations: Array<{ assetKey: string; remediationText: string }>;
      }>({
        systemPrompt,
        userPrompt,
        attachments,
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            remediations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  assetKey: { type: "string", enum: failing.map((f) => f.assetKey) },
                  remediationText: { type: "string" },
                },
                required: ["assetKey", "remediationText"],
              },
            },
          },
          required: ["remediations"],
        },
        schemaName: "dt_remediation",
      });

      const byKey = new Map(res.remediations.map((r) => [r.assetKey, r.remediationText]));
      for (const f of failing) {
        const text = (byKey.get(f.assetKey) ?? "").trim();
        if (!text) continue;
        const existing = await prisma.dTRemediation.findFirst({
          where: { projectId, assetId: f.assetId, requirementId: req.id },
        });
        if (existing) {
          await prisma.dTRemediation.update({
            where: { id: existing.id },
            data: { remediationText: text, aiGenerated: true, aiGeneratedAt: now },
          });
        } else {
          await prisma.dTRemediation.create({
            data: {
              projectId,
              assetId: f.assetId,
              requirementId: req.id,
              remediationText: text,
              aiGenerated: true,
              aiGeneratedAt: now,
            },
          });
        }
        saved++;
      }
    } catch (err) {
      errors.push(`${req.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Prune AI remediations for fails that no longer exist and that the customer
  // has not responded to. (null assetId can't go in a SQLite WHERE via the
  // driver, so load-all + filter-in-JS + delete-by-id.)
  const allRemediations = await prisma.dTRemediation.findMany({
    where: { projectId, aiGenerated: true },
    select: { id: true, assetId: true, requirementId: true, respondedAt: true },
  });
  const staleIds = allRemediations
    .filter((r) => !r.respondedAt && !liveKeys.has(keyOf(r.assetId ?? null, r.requirementId)))
    .map((r) => r.id);
  if (staleIds.length > 0) {
    await prisma.dTRemediation.deleteMany({ where: { id: { in: staleIds } } });
  }

  revalidatePath(`/projects/${projectId}/dt`, "layout");
  return { reqsProcessed, fails, saved, errors };
}
