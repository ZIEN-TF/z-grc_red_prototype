"use server";

// Server actions for AI auto-fill across the screening / assets / DT /
// evidence / assessment stages. Each "fill" action calls the OpenAI Responses
// API with the project's attachments and writes the model's answers into the
// existing tables with `aiGenerated=true`. Per-row `userReviewed` flags are
// flipped via separate review actions.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  loadProjectAttachmentsForAI,
  runAIWithAttachments,
} from "@/lib/ai/openai";
import {
  SCREENING_SYSTEM_PROMPT,
  buildScreeningUserPrompt,
  SCREENING_JSON_SCHEMA,
  type ScreeningAIResult,
} from "@/lib/ai/prompts/screening";
import {
  ASSETS_SYSTEM_PROMPT,
  buildAssetsUserPrompt,
  ASSETS_JSON_SCHEMA,
  type AssetAIResult,
} from "@/lib/ai/prompts/assets";
import {
  DT_SYSTEM_PROMPT,
  buildDTUserPrompt,
  buildDTJsonSchema,
  type DTAIResult,
} from "@/lib/ai/prompts/dt";
import {
  INSTANCES_SYSTEM_PROMPT,
  buildInstancesUserPrompt,
  INSTANCES_JSON_SCHEMA,
  type InstancesAIResult,
} from "@/lib/ai/prompts/instances";
import {
  EVIDENCE_SYSTEM_PROMPT,
  buildEvidenceUserPrompt,
  buildEvidenceJsonSchema,
  type EvidenceAIResult,
} from "@/lib/ai/prompts/evidence";
import {
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentUserPrompt,
  buildAssessmentJsonSchema,
  type AssessmentAIResult,
} from "@/lib/ai/prompts/assessment";
import { applicableAssetKinds, kindConfig } from "@/lib/asset-kinds";
import {
  DT_REQUIREMENTS,
  matchAssetsForRequirement,
  getApplicableKindsFor,
  requirementById,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  walkTree,
  assessmentsFor,
  type DTRequirement,
  type EvidenceField,
  type AssessmentType,
} from "@/lib/decision-trees";
import { evaluateScreening } from "@/lib/screening-questions";
import type { StandardId } from "@/lib/mechanisms";
import { requireSession } from "@/lib/auth";

// Reuse the editable-guard pattern from actions.ts. Inline here rather than
// importing to avoid circular deps with actions.ts.
async function assertProjectEditable(projectId: string) {
  const session = await requireSession();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { finalizedAt: true, userId: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (project.finalizedAt) {
    throw new Error("이 프로젝트는 finalize 되어 잠겨 있습니다.");
  }
  if (
    session.role !== "consultant" &&
    project.userId !== null &&
    project.userId !== session.userId
  ) {
    throw new Error("이 프로젝트에 대한 권한이 없습니다.");
  }
}

// ── Screening AI fill ────────────────────────────────────────────
export async function aiFillScreening(projectId: string) {
  await assertProjectEditable(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      manufacturer: true,
      productType: true,
      productDescription: true,
    },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const attachments = await loadProjectAttachmentsForAI(projectId);
  if (attachments.length === 0) {
    throw new Error(
      "AI가 참고할 첨부 파일이 없습니다. 프로젝트 첨부 파일(이미지·PDF)을 먼저 업로드하세요.",
    );
  }

  const result = await runAIWithAttachments<ScreeningAIResult>({
    systemPrompt: SCREENING_SYSTEM_PROMPT,
    userPrompt: buildScreeningUserPrompt(project),
    attachments,
    jsonSchema: SCREENING_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "screening_answers",
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const a of result.answers) {
      const existing = await tx.screeningAnswer.findUnique({
        where: {
          projectId_questionId: {
            projectId,
            questionId: a.questionId,
          },
        },
      });
      // Skip overwriting answers the user has already explicitly reviewed —
      // a re-run shouldn't clobber confirmed work.
      if (existing?.userReviewed) continue;
      await tx.screeningAnswer.upsert({
        where: {
          projectId_questionId: {
            projectId,
            questionId: a.questionId,
          },
        },
        create: {
          projectId,
          questionId: a.questionId,
          answer: a.answer,
          aiGenerated: true,
          aiGeneratedAt: now,
          userReviewed: false,
        },
        update: {
          answer: a.answer,
          aiGenerated: true,
          aiGeneratedAt: now,
          userReviewed: false,
        },
      });
    }
  });

  revalidatePath(`/projects/${projectId}/screening`);
  return {
    filled: result.answers.length,
    answers: result.answers, // useful if the UI wants to show reasoning inline
  };
}

// Toggle `userReviewed` for one or many screening questions.
export async function setScreeningReviewed(input: {
  projectId: string;
  questionIds: string[];
  reviewed: boolean;
}) {
  await assertProjectEditable(input.projectId);
  const now = input.reviewed ? new Date() : null;
  await prisma.screeningAnswer.updateMany({
    where: {
      projectId: input.projectId,
      questionId: { in: input.questionIds },
    },
    data: {
      userReviewed: input.reviewed,
      userReviewedAt: now,
    },
  });
  revalidatePath(`/projects/${input.projectId}/screening`);
}

// ── Asset inventory AI fill ──────────────────────────────────────
export async function aiFillAssets(projectId: string) {
  await assertProjectEditable(projectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      manufacturer: true,
      productType: true,
      productDescription: true,
      applicable1: true,
      applicable2: true,
      applicable3: true,
      screeningComplete: true,
      screeningAnswers: true,
    },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (!project.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }

  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);
  const applicableKinds = applicableAssetKinds(applicableStandards);

  // Map of saved screening answers — used as prior-stage context so the AI
  // produces an inventory that is consistent with the screening result.
  const screeningAnswers: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswers[a.questionId] = a.answer;
    }
  }

  const attachments = await loadProjectAttachmentsForAI(projectId);
  if (attachments.length === 0) {
    throw new Error(
      "AI가 참고할 첨부 파일이 없습니다. 프로젝트 첨부 파일을 먼저 업로드하세요.",
    );
  }

  const result = await runAIWithAttachments<AssetAIResult>({
    systemPrompt: ASSETS_SYSTEM_PROMPT,
    userPrompt: buildAssetsUserPrompt(
      project,
      applicableKinds,
      screeningAnswers,
    ),
    attachments,
    jsonSchema: ASSETS_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "asset_inventory",
  });

  // Validate + insert. Skip assets whose kind isn't applicable, and filter
  // metadata down to fields that exist on the kind.
  const allowedKindNames = new Set<string>(applicableKinds.map((k) => k.kind));
  const now = new Date();
  let inserted = 0;

  for (const a of result.assets) {
    if (!allowedKindNames.has(a.kind)) continue;
    const cfg = kindConfig(a.kind);
    if (!cfg) continue;
    const fieldNames = new Set(cfg.metadataFields.map((f) => f.name));
    const meta: Record<string, string> = {};
    for (const { key, value } of a.metadata) {
      if (!fieldNames.has(key)) continue;
      // For select fields, drop invalid option values.
      const fdef = cfg.metadataFields.find((f) => f.name === key);
      if (fdef?.type === "select" && fdef.options) {
        const allowed = new Set(fdef.options.map((o) => o.value));
        if (!allowed.has(value)) continue;
      }
      meta[key] = value;
    }
    await prisma.asset.create({
      data: {
        projectId,
        kind: a.kind,
        name: a.name.trim() || "(이름 없음)",
        description: a.description?.trim() || null,
        metadata: JSON.stringify(meta),
        aiGenerated: true,
        aiGeneratedAt: now,
        userReviewed: false,
      },
    });
    inserted++;
  }

  revalidatePath(`/projects/${projectId}/assets`);
  revalidatePath(`/projects/${projectId}/assets/review`);
  return { inserted };
}

// Toggle `userReviewed` for one or many asset rows.
export async function setAssetsReviewed(input: {
  projectId: string;
  assetIds: string[];
  reviewed: boolean;
}) {
  await assertProjectEditable(input.projectId);
  const now = input.reviewed ? new Date() : null;
  await prisma.asset.updateMany({
    where: {
      projectId: input.projectId,
      id: { in: input.assetIds },
    },
    data: {
      userReviewed: input.reviewed,
      userReviewedAt: now,
    },
  });
  revalidatePath(`/projects/${input.projectId}/assets`);
  revalidatePath(`/projects/${input.projectId}/assets/review`);
}

// ── Shared helpers for DT AI fill ────────────────────────────────
type ParsedAsset = {
  id: string;
  kind: string;
  name: string;
  metadata: Record<string, string>;
};

function parseAssetsForAI(
  raw: Array<{ id: string; kind: string; name: string; metadata: string }>,
): ParsedAsset[] {
  return raw.map((a) => {
    let metadata: Record<string, string> = {};
    try {
      const parsed = JSON.parse(a.metadata);
      if (parsed && typeof parsed === "object") {
        metadata = parsed as Record<string, string>;
      }
    } catch {}
    return { id: a.id, kind: a.kind, name: a.name, metadata };
  });
}

function buildAssetSummary(parsedAssets: ParsedAsset[]): string {
  const assetsByKind = new Map<string, ParsedAsset[]>();
  for (const a of parsedAssets) {
    const list = assetsByKind.get(a.kind) ?? [];
    list.push(a);
    assetsByKind.set(a.kind, list);
  }
  return Array.from(assetsByKind.entries())
    .map(([kind, arr]) => {
      const cfg = kindConfig(kind);
      const label = cfg?.title_ko ?? kind;
      const lines = arr
        .map((a) => {
          const metaShort = Object.entries(a.metadata)
            .filter(([, v]) => v && v !== "")
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          return `   • ${a.name}${metaShort ? ` [${metaShort}]` : ""}`;
        })
        .join("\n");
      return `## ${label} (${kind})\n${lines}`;
    })
    .join("\n");
}

type SingleReqContext = {
  project: {
    name: string;
    manufacturer: string;
    productType: string | null;
    productDescription: string | null;
  };
  parsedAssets: ParsedAsset[];
  screeningAnswers: Record<string, "yes" | "no">;
  applicableStandards: StandardId[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attachments: any[];
};

// Server-side DT tree walker. Given a map of answered nodes, returns:
//   - reachedLeaf: did we walk to an outcome (pass/fail/not_applicable)?
//   - missingNodeId: the first node on the path that lacks an answer (or
//     undefined if path is fully resolved or a cycle was detected).
//   - onPathAnswers: only the answers that actually lie on the resolved path
//     (off-path AI answers are dropped).
function walkDTPath(
  requirement: DTRequirement,
  answers: Map<string, { answer: "yes" | "no"; reasoning: string }>,
): {
  reachedLeaf: boolean;
  missingNodeId: string | undefined;
  onPathAnswers: Array<{ nodeId: string; answer: "yes" | "no"; reasoning: string }>;
} {
  const onPathAnswers: Array<{ nodeId: string; answer: "yes" | "no"; reasoning: string }> = [];
  const visited = new Set<string>();
  let currentId = requirement.rootNodeId;
  while (true) {
    const node = requirement.nodes[currentId];
    if (!node) {
      // Malformed DT — bail out, treat as no leaf.
      return { reachedLeaf: false, missingNodeId: undefined, onPathAnswers };
    }
    if (visited.has(currentId)) {
      // Cycle guard.
      return { reachedLeaf: false, missingNodeId: undefined, onPathAnswers };
    }
    visited.add(currentId);
    const ans = answers.get(currentId);
    if (!ans) {
      return { reachedLeaf: false, missingNodeId: currentId, onPathAnswers };
    }
    onPathAnswers.push({ nodeId: currentId, answer: ans.answer, reasoning: ans.reasoning });
    const branch = ans.answer === "yes" ? node.yes : node.no;
    if ("outcome" in branch) {
      return { reachedLeaf: true, missingNodeId: undefined, onPathAnswers };
    }
    currentId = branch.goto;
  }
}

// Ask the AI for the answer to a SINGLE DT node. Used to fill in nodes that
// the bundled "walk the whole tree" call dropped. Schema restricts the nodeId
// enum so the model can't return a wrong node.
async function aiAnswerSingleDTNode(opts: {
  requirement: DTRequirement;
  iteration: { assetKey: string; label: string; metadata: Record<string, string> };
  nodeId: string;
  prior: Array<{ nodeId: string; answer: "yes" | "no"; reasoning: string }>;
  ctx: SingleReqContext;
  assetSummary: string;
}): Promise<{ answer: "yes" | "no"; reasoning: string }> {
  const { requirement, iteration, nodeId, prior, ctx, assetSummary } = opts;
  const node = requirement.nodes[nodeId];
  if (!node) throw new Error(`알 수 없는 DT 노드: ${nodeId}`);

  const priorBlock =
    prior.length === 0
      ? "(없음 — 이 노드가 시작 노드입니다)"
      : prior
          .map((a, i) => {
            const n = requirement.nodes[a.nodeId];
            return `${i + 1}. [${a.nodeId}] ${n?.text_ko ?? ""} → ${a.answer.toUpperCase()}\n   근거: ${a.reasoning}`;
          })
          .join("\n");

  const yesBranch =
    "outcome" in node.yes
      ? `→ 결과: ${node.yes.outcome.toUpperCase()}`
      : `→ 다음 노드: ${node.yes.goto}`;
  const noBranch =
    "outcome" in node.no
      ? `→ 결과: ${node.no.outcome.toUpperCase()}`
      : `→ 다음 노드: ${node.no.goto}`;

  const productInfo = [
    `제품명: ${ctx.project.name}`,
    `제조사: ${ctx.project.manufacturer}`,
    ctx.project.productType ? `제품 유형: ${ctx.project.productType}` : null,
    ctx.project.productDescription
      ? `제품 설명:\n${ctx.project.productDescription}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = `다음 DT 노드에 대해 yes/no로 답하세요. 이전 노드 답변은 이미 결정되었으므로 그 흐름에 정합하게 답해야 합니다.

=== 제품 정보 ===
${productInfo}

=== 자산 인벤토리 (요약) ===
${assetSummary || "(자산 없음)"}

=== 요구사항 ===
ID: ${requirement.id} · ${requirement.clause}
제목: ${requirement.title_ko}
원문:
${requirement.requirementText_ko}

=== 현재 평가 단위 ===
${iteration.label} (assetKey="${iteration.assetKey}")
${Object.entries(iteration.metadata).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

=== 지금까지의 DT 답변 (이 평가 단위에서 이미 결정됨) ===
${priorBlock}

=== 답해야 하는 노드 ===
[${nodeId}] ${node.text_ko}
${node.hint_ko ? `힌트: ${node.hint_ko}` : ""}
- YES ${yesBranch}
- NO  ${noBranch}

이 단일 노드에 대해서만 { nodeId, answer, reasoning } 형태로 답하세요.
reasoning은 1~2문장 한국어 — 근거 + 판단을 적으세요.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      nodeId: { type: "string", enum: [nodeId] },
      answer: { type: "string", enum: ["yes", "no"] },
      reasoning: { type: "string" },
    },
    required: ["nodeId", "answer", "reasoning"],
  };

  const res = await runAIWithAttachments<{
    nodeId: string;
    answer: "yes" | "no";
    reasoning: string;
  }>({
    systemPrompt: DT_SYSTEM_PROMPT,
    userPrompt,
    attachments: ctx.attachments,
    jsonSchema: schema,
    schemaName: "dt_single_node",
  });

  return { answer: res.answer, reasoning: res.reasoning };
}

// Compute the iteration list for a DT requirement (one entry per asset that
// matches the requirement's iterateOver scope, or a single "__global__" entry
// for non-iterating requirements). Pulled out so the bulk init action can
// return the flat (requirement, iteration) cross-product to the client.
function computeRequirementIterations(
  requirement: DTRequirement,
  parsedAssets: ParsedAsset[],
  applicableStandards: StandardId[],
): Array<{ assetKey: string; label: string; metadata: Record<string, string> }> {
  if (!requirement.iterateOver) {
    return [
      { assetKey: "__global__", label: "기기 전체 / Global", metadata: {} },
    ];
  }
  const dedupedKinds = getApplicableKindsFor(
    requirement,
    DT_REQUIREMENTS,
    applicableStandards,
  );
  const matching = matchAssetsForRequirement(
    requirement,
    parsedAssets,
    dedupedKinds,
  );
  return matching.map((a) => ({
    assetKey: a.id,
    label: `${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})`,
    metadata: a.metadata,
  }));
}

// Run the AI for one DT iteration: a bundled "walk the whole tree" call,
// then server-side tree validation with per-node fallback for any nodes the
// model skipped. Returns the resolved on-path answer sequence. Does NOT
// touch the database — that's persistOneDTIteration's job.
async function aiFillOneDTIteration(opts: {
  requirement: DTRequirement;
  iteration: { assetKey: string; label: string; metadata: Record<string, string> };
  ctx: SingleReqContext;
  assetSummary: string;
}): Promise<{
  onPathAnswers: Array<{ nodeId: string; answer: "yes" | "no"; reasoning: string }>;
  reachedLeaf: boolean;
  fallbackCalls: number;
}> {
  const { requirement, iteration, ctx, assetSummary } = opts;
  const MAX_FALLBACK_CALLS_PER_ITERATION = 12;

  let bundled: DTAIResult["iterations"][number]["answers"] = [];
  try {
    const res = await runAIWithAttachments<DTAIResult>({
      systemPrompt: DT_SYSTEM_PROMPT,
      userPrompt: buildDTUserPrompt({
        project: ctx.project,
        requirement,
        iterations: [iteration],
        screeningAnswers: ctx.screeningAnswers,
        assetSummary,
      }),
      attachments: ctx.attachments,
      jsonSchema: buildDTJsonSchema(requirement, [iteration.assetKey]),
      schemaName: "dt_answers",
    });
    bundled =
      res.iterations.find((r) => r.assetKey === iteration.assetKey)?.answers ?? [];
  } catch (err) {
    // Bundled call failed — the per-node fallback below will populate the
    // entire path one node at a time.
    console.warn(
      `DT bundled call failed for ${requirement.id} / ${iteration.assetKey}, falling back to per-node:`,
      err,
    );
  }

  const answerMap = new Map<
    string,
    { answer: "yes" | "no"; reasoning: string }
  >();
  for (const a of bundled) {
    if (!requirement.nodes[a.nodeId]) continue;
    answerMap.set(a.nodeId, { answer: a.answer, reasoning: a.reasoning });
  }

  let walk = walkDTPath(requirement, answerMap);
  let fallbackCalls = 0;
  while (
    !walk.reachedLeaf &&
    walk.missingNodeId !== undefined &&
    fallbackCalls < MAX_FALLBACK_CALLS_PER_ITERATION
  ) {
    const missing = walk.missingNodeId;
    const single = await aiAnswerSingleDTNode({
      requirement,
      iteration,
      nodeId: missing,
      prior: walk.onPathAnswers,
      ctx,
      assetSummary,
    });
    answerMap.set(missing, single);
    fallbackCalls++;
    walk = walkDTPath(requirement, answerMap);
  }

  return {
    onPathAnswers: walk.onPathAnswers,
    reachedLeaf: walk.reachedLeaf,
    fallbackCalls,
  };
}

// Persist the on-path answers for one DT iteration. Scoped to the specific
// (projectId, requirementId, assetId) tuple so other iterations aren't
// disturbed. User-reviewed rows are preserved.
async function persistOneDTIteration(opts: {
  projectId: string;
  requirement: DTRequirement;
  assetKey: string;
  onPathAnswers: Array<{ nodeId: string; answer: "yes" | "no"; reasoning: string }>;
}): Promise<{ saved: number }> {
  const { projectId, requirement, assetKey, onPathAnswers } = opts;
  const targetAssetId: string | null = assetKey === "__global__" ? null : assetKey;

  // better-sqlite3 generates `= NULL` (always false) for null in WHERE, so we
  // can't query/delete null-assetId rows directly. Load everything for the
  // requirement and filter in JS.
  const allExisting = await prisma.dTAnswer.findMany({
    where: { projectId, requirementId: requirement.id },
    select: { id: true, assetId: true, nodeId: true, userReviewed: true },
  });
  const rowsForThisIteration = allExisting.filter(
    (r) => (r.assetId ?? null) === targetAssetId,
  );
  const reviewedNodeIds = new Set(
    rowsForThisIteration.filter((r) => r.userReviewed).map((r) => r.nodeId),
  );
  const unreviewedIds = rowsForThisIteration
    .filter((r) => !r.userReviewed)
    .map((r) => r.id);

  if (unreviewedIds.length > 0) {
    await prisma.dTAnswer.deleteMany({ where: { id: { in: unreviewedIds } } });
  }

  const validNodeIds = new Set(Object.keys(requirement.nodes));
  const seenNodeIds = new Set<string>();
  const now = new Date();
  const toCreate = [];
  for (const ans of onPathAnswers) {
    if (!validNodeIds.has(ans.nodeId)) continue;
    if (seenNodeIds.has(ans.nodeId)) continue;
    seenNodeIds.add(ans.nodeId);
    if (reviewedNodeIds.has(ans.nodeId)) continue; // keep user-reviewed
    toCreate.push({
      projectId,
      assetId: targetAssetId,
      mechanismCode: requirement.mechanismCode,
      requirementId: requirement.id,
      nodeId: ans.nodeId,
      answer: ans.answer,
      notes: ans.reasoning ?? null,
      aiGenerated: true,
      aiGeneratedAt: now,
      userReviewed: false,
    });
  }
  if (toCreate.length > 0) {
    await prisma.dTAnswer.createMany({ data: toCreate });
  }
  return { saved: toCreate.length };
}

// Fill a single DT requirement using the shared project context. Returns
// counts; saves rows directly to DB. Skips iterations the user already
// reviewed, replaces unreviewed AI rows with fresh AI output.
async function fillSingleDTRequirement(
  projectId: string,
  requirement: DTRequirement,
  ctx: SingleReqContext,
): Promise<{ saved: number; iterationsAnswered: number }> {
  type IterationInput = {
    assetKey: string;
    label: string;
    metadata: Record<string, string>;
  };
  const iterations: IterationInput[] = [];
  if (requirement.iterateOver) {
    const dedupedKinds = getApplicableKindsFor(
      requirement,
      DT_REQUIREMENTS,
      ctx.applicableStandards,
    );
    const matching = matchAssetsForRequirement(
      requirement,
      ctx.parsedAssets,
      dedupedKinds,
    );
    for (const a of matching) {
      iterations.push({
        assetKey: a.id,
        label: `${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})`,
        metadata: a.metadata,
      });
    }
  } else {
    iterations.push({
      assetKey: "__global__",
      label: "기기 전체 / Global",
      metadata: {},
    });
  }

  if (iterations.length === 0) return { saved: 0, iterationsAnswered: 0 };

  const assetSummary = buildAssetSummary(ctx.parsedAssets);

  // ── Per-iteration AI fill with server-side completion ───────────────────
  //
  // gpt-4o-mini is unreliable at two things when given a bundled DT prompt:
  //   1. answering for *every* iteration in a multi-iteration requirement
  //      (it often answers the first one or two and stops), and
  //   2. walking a single iteration's tree all the way to a leaf (it often
  //      answers the root node and stops).
  //
  // The fix: process one iteration at a time, then validate the returned
  // path by walking the DT server-side. Any node that's missing from the
  // path is filled in by a focused single-node AI call. Off-path "extra"
  // answers from the bundled call are dropped — only the actual on-path
  // sequence (root → leaf) is persisted.
  const MAX_FALLBACK_CALLS_PER_ITERATION = 12;
  const aggregated: DTAIResult = { iterations: [] };
  const iterationErrors: string[] = [];
  for (const it of iterations) {
    try {
      // First pass: bundled "walk the whole tree" call.
      let bundled: DTAIResult["iterations"][number]["answers"] = [];
      try {
        const res = await runAIWithAttachments<DTAIResult>({
          systemPrompt: DT_SYSTEM_PROMPT,
          userPrompt: buildDTUserPrompt({
            project: ctx.project,
            requirement,
            iterations: [it],
            screeningAnswers: ctx.screeningAnswers,
            assetSummary,
          }),
          attachments: ctx.attachments,
          jsonSchema: buildDTJsonSchema(requirement, [it.assetKey]),
          schemaName: "dt_answers",
        });
        bundled = res.iterations.find((r) => r.assetKey === it.assetKey)?.answers ?? [];
      } catch (err) {
        // If even the bundled call failed we proceed with an empty bundle;
        // the per-node fallback below will populate the entire path.
        console.warn(
          `DT bundled call failed for ${requirement.id} / ${it.assetKey}, falling back to per-node:`,
          err,
        );
      }

      const answerMap = new Map<
        string,
        { answer: "yes" | "no"; reasoning: string }
      >();
      for (const a of bundled) {
        if (!requirement.nodes[a.nodeId]) continue;
        answerMap.set(a.nodeId, { answer: a.answer, reasoning: a.reasoning });
      }

      // Walk the tree using the bundled answers. If any node on the path is
      // missing, fill it in with a focused single-node call, then re-walk.
      let walk = walkDTPath(requirement, answerMap);
      let fallbackCalls = 0;
      while (
        !walk.reachedLeaf &&
        walk.missingNodeId !== undefined &&
        fallbackCalls < MAX_FALLBACK_CALLS_PER_ITERATION
      ) {
        const missing = walk.missingNodeId;
        const single = await aiAnswerSingleDTNode({
          requirement,
          iteration: it,
          nodeId: missing,
          prior: walk.onPathAnswers,
          ctx,
          assetSummary,
        });
        answerMap.set(missing, single);
        fallbackCalls++;
        walk = walkDTPath(requirement, answerMap);
      }

      // Persist only the on-path answers we resolved. If we still didn't
      // reach a leaf after the fallback budget, what we have is at least the
      // partial path the user can finish manually.
      aggregated.iterations.push({
        assetKey: it.assetKey,
        answers: walk.onPathAnswers,
      });

      if (!walk.reachedLeaf) {
        console.warn(
          `DT path not fully resolved for ${requirement.id} / ${it.assetKey} after ${fallbackCalls} fallback calls; persisted ${walk.onPathAnswers.length} on-path answers.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI 호출 실패";
      iterationErrors.push(`${it.assetKey} (${it.label}): ${msg}`);
      console.error(
        `DT iteration AI fill error (${requirement.id} / ${it.assetKey}):`,
        err,
      );
    }
  }

  // If every iteration failed, propagate so the caller can surface it.
  // Partial failure: persist whatever we got, the caller logs the rest.
  if (
    aggregated.iterations.length === 0 &&
    iterationErrors.length > 0
  ) {
    throw new Error(iterationErrors.join("; "));
  }

  const result = aggregated;
  const validAssetKeys = iterations.map((it) => it.assetKey);
  const validKeySet = new Set(validAssetKeys);
  const validNodeIds = new Set(Object.keys(requirement.nodes));
  const now = new Date();
  let saved = 0;
  let iterationsAnswered = 0;

  // ── Step A: load all existing rows for this (project, req) ─────────────────
  // No assetId in WHERE — better-sqlite3 generates `= NULL` (always false) for null.
  const allExisting = await prisma.dTAnswer.findMany({
    where: { projectId, requirementId: requirement.id },
    select: { id: true, assetId: true, nodeId: true, userReviewed: true },
  });

  // Keys of user-reviewed rows: `${assetId ?? ""}::${nodeId}`
  // ?? "" handles both null and undefined returned by the driver.
  const reviewedKeys = new Set<string>(
    allExisting
      .filter((r) => Boolean(r.userReviewed))
      .map((r) => `${r.assetId ?? ""}::${r.nodeId}`),
  );

  // ── Step B: delete all unreviewed rows by their id list ────────────────────
  // deleteMany with `id: { in: [...] }` never touches null in WHERE — safe.
  const idsToDelete = allExisting
    .filter((r) => !Boolean(r.userReviewed))
    .map((r) => r.id);
  if (idsToDelete.length > 0) {
    await prisma.dTAnswer.deleteMany({ where: { id: { in: idsToDelete } } });
  }

  // ── Step C: build the create list ─────────────────────────────────────────
  // createdKeys deduplicates entries when the AI returns the same (asset, node)
  // across multiple iterations in its response.
  const createdKeys = new Set<string>();
  type CreateRow = {
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
  };
  const toCreate: CreateRow[] = [];

  for (const it of result.iterations) {
    if (!validKeySet.has(it.assetKey)) continue;
    const assetId = it.assetKey === "__global__" ? null : it.assetKey;
    const assetPrefix = assetId ?? "";

    let rowsForThisIter = 0;
    const seenNodeIds = new Set<string>();
    for (const ans of it.answers) {
      if (!validNodeIds.has(ans.nodeId)) continue;
      if (seenNodeIds.has(ans.nodeId)) continue;
      seenNodeIds.add(ans.nodeId);

      const key = `${assetPrefix}::${ans.nodeId}`;
      if (reviewedKeys.has(key)) continue; // keep user-reviewed rows intact
      if (createdKeys.has(key)) continue;  // skip AI-response duplicates
      createdKeys.add(key);

      toCreate.push({
        projectId,
        assetId,
        mechanismCode: requirement.mechanismCode,
        requirementId: requirement.id,
        nodeId: ans.nodeId,
        answer: ans.answer,
        notes: ans.reasoning ?? null,
        aiGenerated: true,
        aiGeneratedAt: now,
        userReviewed: false,
      });
      saved++;
      rowsForThisIter++;
    }
    if (rowsForThisIter > 0) iterationsAnswered++;
  }

  // ── Step D: batch insert the new rows ─────────────────────────────────────
  // After the delete above, no existing unreviewed rows remain for this req,
  // so createMany will not hit any unique constraint.
  if (toCreate.length > 0) {
    await prisma.dTAnswer.createMany({ data: toCreate });
  }

  return { saved, iterationsAnswered };
}

async function loadDTContext(projectId: string): Promise<SingleReqContext & {
  raw: NonNullable<Awaited<ReturnType<typeof prisma.project.findUnique>>>;
}> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { assets: true, screeningAnswers: true },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");

  const screeningAnswers: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswers[a.questionId] = a.answer;
    }
  }

  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);

  const parsedAssets = parseAssetsForAI(project.assets);
  const attachments = await loadProjectAttachmentsForAI(projectId);

  return {
    project,
    parsedAssets,
    screeningAnswers,
    applicableStandards,
    attachments,
    raw: project,
  };
}

// Compute the list of DT requirement IDs that are visible/applicable for a
// project given its screening answers and applicable standards. Shared by
// aiFillDTInit and aiFillDTAll.
function computeVisibleRequirementIds(
  ctx: SingleReqContext & {
    raw: { mechanismCandidates: string };
  },
): string[] {
  const candidates: string[] =
    ctx.raw.mechanismCandidates.length > 0
      ? (JSON.parse(ctx.raw.mechanismCandidates) as string[])
      : [];
  const recomputed = evaluateScreening(ctx.screeningAnswers);
  const finalCandidates =
    recomputed.candidateMechanisms.length > 0
      ? recomputed.candidateMechanisms
      : candidates;
  const finalStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ctx.applicableStandards;

  return DT_REQUIREMENTS.filter(
    (r) =>
      finalCandidates.includes(r.mechanismCode) &&
      r.standards.some((s) => finalStandards.includes(s)) &&
      evaluateRequirementApplicability(r, ctx.screeningAnswers).applies,
  ).map((r) => r.id);
}

// Step 1 of the chunked DT bulk fill — does the heavy upfront work (loading
// attachments, creating ACM/authenticator instances if missing) and returns
// the flat (requirementId, assetKey) iteration list the client should walk.
//
// Splitting the bulk fill into init + per-iteration calls keeps each
// server-action invocation under proxy timeouts (Cloudflare's 100s limit in
// particular). The total amount of OpenAI work is unchanged.
export async function aiFillDTInit(projectId: string): Promise<{
  acmsCreated: number;
  authsCreated: number;
  sumsCreated: number;
  // Backward-compat: the unique requirement IDs in the iteration list.
  requirementIds: string[];
  // Flat list of (requirementId, assetKey) pairs to process. Each pair is
  // one server-action call (aiFillDTIteration) on the client.
  iterations: Array<{ requirementId: string; assetKey: string; label: string }>;
}> {
  await assertProjectEditable(projectId);

  const ctx = await loadDTContext(projectId);
  if (!ctx.raw.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }
  if (ctx.attachments.length === 0) {
    throw new Error(
      "AI가 참고할 첨부 파일이 없습니다. 프로젝트 첨부 파일을 먼저 업로드하세요.",
    );
  }

  const acmCount = ctx.parsedAssets.filter(
    (a) => a.kind === "acm_instance",
  ).length;
  const authCount = ctx.parsedAssets.filter(
    (a) => a.kind === "authenticator_instance",
  ).length;
  const sumCount = ctx.parsedAssets.filter(
    (a) => a.kind === "sum_instance",
  ).length;

  let acmsCreated = 0;
  let authsCreated = 0;
  let sumsCreated = 0;

  if (acmCount === 0 || authCount === 0 || sumCount === 0) {
    const assetSummary = buildAssetSummary(ctx.parsedAssets);
    const inst = await runAIWithAttachments<InstancesAIResult>({
      systemPrompt: INSTANCES_SYSTEM_PROMPT,
      userPrompt: buildInstancesUserPrompt(
        ctx.project,
        ctx.screeningAnswers,
        assetSummary,
      ),
      attachments: ctx.attachments,
      jsonSchema: INSTANCES_JSON_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "instances",
    });

    const now = new Date();
    const acmIdByName = new Map<string, string>();

    if (acmCount === 0) {
      for (const a of inst.acms) {
        const trimmedName = a.name.trim() || "(이름 없음)";
        const meta = JSON.stringify({
          interface_network: a.interfaceNetwork ? "yes" : "no",
          interface_user: a.interfaceUser ? "yes" : "no",
          interface_machine: a.interfaceMachine ? "yes" : "no",
          acm_type: a.acmType,
        });
        const row = await prisma.asset.create({
          data: {
            projectId,
            kind: "acm_instance",
            name: trimmedName,
            metadata: meta,
            aiGenerated: true,
            aiGeneratedAt: now,
            userReviewed: false,
          },
        });
        acmIdByName.set(trimmedName, row.id);
        acmsCreated++;
      }
    } else {
      for (const a of ctx.parsedAssets.filter(
        (x) => x.kind === "acm_instance",
      )) {
        acmIdByName.set(a.name, a.id);
      }
    }

    if (authCount === 0) {
      for (const auth of inst.authenticators) {
        const parentId = acmIdByName.get(auth.acmName.trim());
        if (!parentId) continue;
        // Default password authenticators with empty subtype to "user_set"
        // so AUM-5-2 and AUM-6 iteration filters match. Empty would leave
        // those DTs as N/A even when the device clearly uses passwords.
        // Empty string is falsy, so this catches both "" and undefined.
        const passwordSubtype =
          auth.authType === "password" && !auth.passwordSubtype
            ? "user_set"
            : auth.passwordSubtype;
        // IMPORTANT: metadata key names must match the field names declared
        // in asset-kinds.ts (authenticator_instance config) — the DT
        // iterateOver filters key by those exact strings. Use camelCase
        // (authType, passwordSubtype), NOT snake_case.
        const meta = JSON.stringify({
          acm_id: parentId,
          authType: auth.authType,
          passwordSubtype,
        });
        await prisma.asset.create({
          data: {
            projectId,
            kind: "authenticator_instance",
            name: auth.name.trim() || "(이름 없음)",
            metadata: meta,
            aiGenerated: true,
            aiGeneratedAt: now,
            userReviewed: false,
          },
        });
        authsCreated++;
      }
    }

    if (sumCount === 0) {
      // sum_instance has no metadata fields (see asset-kinds.ts). It's a
      // pure iteration marker — SUM-2 / SUM-3 walk one DT per instance.
      for (const sum of inst.sums) {
        const trimmedName = sum.name.trim() || "(이름 없음)";
        await prisma.asset.create({
          data: {
            projectId,
            kind: "sum_instance",
            name: trimmedName,
            metadata: JSON.stringify({}),
            aiGenerated: true,
            aiGeneratedAt: now,
            userReviewed: false,
          },
        });
        sumsCreated++;
      }
    }

    if (acmsCreated > 0 || authsCreated > 0 || sumsCreated > 0) {
      const refreshed = await prisma.asset.findMany({
        where: { projectId },
      });
      ctx.parsedAssets = parseAssetsForAI(refreshed);
    }
  }

  const requirementIds = computeVisibleRequirementIds(ctx);

  // Recompute the applicable standards the same way computeVisibleRequirementIds
  // does so iteration scoping uses an identical view of the project.
  const recomputed = evaluateScreening(ctx.screeningAnswers);
  const finalStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ctx.applicableStandards;

  // Flatten into (requirementId, assetKey) pairs the client can iterate over.
  // Each pair becomes one aiFillDTIteration call; this is what keeps any
  // individual request well under the proxy timeout window.
  const iterations: Array<{ requirementId: string; assetKey: string; label: string }> = [];
  for (const reqId of requirementIds) {
    const req = requirementById(reqId);
    if (!req) continue;
    const its = computeRequirementIterations(
      req,
      ctx.parsedAssets,
      finalStandards,
    );
    for (const it of its) {
      iterations.push({
        requirementId: reqId,
        assetKey: it.assetKey,
        label: it.label,
      });
    }
  }

  // Revalidate the assets pages so newly-created instances appear.
  if (acmsCreated > 0 || authsCreated > 0 || sumsCreated > 0) {
    revalidatePath(`/projects/${projectId}/assets`);
    revalidatePath(`/projects/${projectId}/assets/review`);
  }

  return { acmsCreated, authsCreated, sumsCreated, requirementIds, iterations };
}

// Step 2 of the chunked DT bulk fill — processes exactly one (requirement,
// iteration) pair. Designed to be called from the client in a loop after
// aiFillDTInit returns the iteration list. Each call typically completes in
// a few seconds and is the unit of progress reporting in the UI.
export async function aiFillDTIteration(
  projectId: string,
  requirementId: string,
  assetKey: string,
): Promise<{ saved: number; reachedLeaf: boolean; fallbackCalls: number }> {
  await assertProjectEditable(projectId);

  const req = requirementById(requirementId);
  if (!req) throw new Error(`알 수 없는 DT 요구사항: ${requirementId}`);

  const ctx = await loadDTContext(projectId);
  if (!ctx.raw.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }
  if (ctx.attachments.length === 0) {
    throw new Error("AI가 참고할 첨부 파일이 없습니다.");
  }

  const recomputed = evaluateScreening(ctx.screeningAnswers);
  const finalStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ctx.applicableStandards;

  // Re-derive the iteration's metadata/label from the live asset list so
  // assetKeys passed by the client are validated against the current project
  // state. assetKey="__global__" is allowed for non-iterating requirements.
  const allIterations = computeRequirementIterations(
    req,
    ctx.parsedAssets,
    finalStandards,
  );
  const iteration = allIterations.find((it) => it.assetKey === assetKey);
  if (!iteration) {
    throw new Error(
      `유효하지 않은 평가 단위: ${requirementId} / ${assetKey} (자산이 삭제됐을 수 있음)`,
    );
  }

  const assetSummary = buildAssetSummary(ctx.parsedAssets);
  const r = await aiFillOneDTIteration({
    requirement: req,
    iteration,
    ctx: {
      project: ctx.project,
      parsedAssets: ctx.parsedAssets,
      screeningAnswers: ctx.screeningAnswers,
      applicableStandards: finalStandards,
      attachments: ctx.attachments,
    },
    assetSummary,
  });

  const persisted = await persistOneDTIteration({
    projectId,
    requirement: req,
    assetKey,
    onPathAnswers: r.onPathAnswers,
  });

  revalidatePath(`/projects/${projectId}/dt/${requirementId}`);

  return {
    saved: persisted.saved,
    reachedLeaf: r.reachedLeaf,
    fallbackCalls: r.fallbackCalls,
  };
}

// Step 2 of the chunked DT bulk fill — processes exactly one DT requirement.
// Designed to be called from the client in a loop after aiFillDTInit returns
// the list of requirement IDs. Each call typically completes in well under
// the proxy timeout window.
export async function aiFillDTRequirement(
  projectId: string,
  requirementId: string,
): Promise<{ saved: number; iterationsAnswered: number; skipped: boolean }> {
  await assertProjectEditable(projectId);

  const req = requirementById(requirementId);
  if (!req) throw new Error(`알 수 없는 DT 요구사항: ${requirementId}`);

  const ctx = await loadDTContext(projectId);
  if (!ctx.raw.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }
  if (ctx.attachments.length === 0) {
    throw new Error("AI가 참고할 첨부 파일이 없습니다.");
  }

  // Use the same applicability filter as the bulk path so we never accept a
  // requirement that should not have been listed.
  const recomputed = evaluateScreening(ctx.screeningAnswers);
  const finalStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ctx.applicableStandards;

  const r = await fillSingleDTRequirement(projectId, req, {
    project: ctx.project,
    parsedAssets: ctx.parsedAssets,
    screeningAnswers: ctx.screeningAnswers,
    applicableStandards: finalStandards,
    attachments: ctx.attachments,
  });

  revalidatePath(`/projects/${projectId}/dt/${requirementId}`);

  return {
    saved: r.saved,
    iterationsAnswered: r.iterationsAnswered,
    skipped: r.iterationsAnswered === 0,
  };
}

// ── Bulk DT AI fill — instances + every visible requirement ──────
export async function aiFillDTAll(projectId: string) {
  await assertProjectEditable(projectId);

  const ctx = await loadDTContext(projectId);
  if (!ctx.raw.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }
  if (ctx.attachments.length === 0) {
    throw new Error(
      "AI가 참고할 첨부 파일이 없습니다. 프로젝트 첨부 파일을 먼저 업로드하세요.",
    );
  }

  // ── Step 1: Make sure ACM, authenticator, and SUM instances exist ─────
  const acmCount = ctx.parsedAssets.filter(
    (a) => a.kind === "acm_instance",
  ).length;
  const authCount = ctx.parsedAssets.filter(
    (a) => a.kind === "authenticator_instance",
  ).length;
  const sumCount = ctx.parsedAssets.filter(
    (a) => a.kind === "sum_instance",
  ).length;

  let acmsCreated = 0;
  let authsCreated = 0;
  let sumsCreated = 0;

  if (acmCount === 0 || authCount === 0 || sumCount === 0) {
    const assetSummary = buildAssetSummary(ctx.parsedAssets);
    const inst = await runAIWithAttachments<InstancesAIResult>({
      systemPrompt: INSTANCES_SYSTEM_PROMPT,
      userPrompt: buildInstancesUserPrompt(
        ctx.project,
        ctx.screeningAnswers,
        assetSummary,
      ),
      attachments: ctx.attachments,
      jsonSchema: INSTANCES_JSON_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "instances",
    });

    const now = new Date();
    const acmIdByName = new Map<string, string>();

    if (acmCount === 0) {
      for (const a of inst.acms) {
        const trimmedName = a.name.trim() || "(이름 없음)";
        const meta = JSON.stringify({
          interface_network: a.interfaceNetwork ? "yes" : "no",
          interface_user: a.interfaceUser ? "yes" : "no",
          interface_machine: a.interfaceMachine ? "yes" : "no",
          acm_type: a.acmType,
        });
        const row = await prisma.asset.create({
          data: {
            projectId,
            kind: "acm_instance",
            name: trimmedName,
            metadata: meta,
            aiGenerated: true,
            aiGeneratedAt: now,
            userReviewed: false,
          },
        });
        acmIdByName.set(trimmedName, row.id);
        acmsCreated++;
      }
    } else {
      // Pre-populate the name→id map from existing ACMs so authenticator
      // creation can still resolve parents even when ACMs already exist.
      for (const a of ctx.parsedAssets.filter(
        (x) => x.kind === "acm_instance",
      )) {
        acmIdByName.set(a.name, a.id);
      }
    }

    if (authCount === 0) {
      for (const auth of inst.authenticators) {
        const parentId = acmIdByName.get(auth.acmName.trim());
        if (!parentId) continue; // skip orphaned authenticators
        // Empty string is falsy, so this catches both "" and undefined.
        const passwordSubtype =
          auth.authType === "password" && !auth.passwordSubtype
            ? "user_set"
            : auth.passwordSubtype;
        // camelCase keys to match asset-kinds.ts field names — the DT
        // iterateOver filters depend on this exact spelling.
        const meta = JSON.stringify({
          acm_id: parentId,
          authType: auth.authType,
          passwordSubtype,
        });
        await prisma.asset.create({
          data: {
            projectId,
            kind: "authenticator_instance",
            name: auth.name.trim() || "(이름 없음)",
            metadata: meta,
            aiGenerated: true,
            aiGeneratedAt: now,
            userReviewed: false,
          },
        });
        authsCreated++;
      }
    }

    if (sumCount === 0) {
      for (const sum of inst.sums) {
        await prisma.asset.create({
          data: {
            projectId,
            kind: "sum_instance",
            name: sum.name.trim() || "(이름 없음)",
            metadata: JSON.stringify({}),
            aiGenerated: true,
            aiGeneratedAt: now,
            userReviewed: false,
          },
        });
        sumsCreated++;
      }
    }

    if (acmsCreated > 0 || authsCreated > 0 || sumsCreated > 0) {
      // Reload assets so subsequent DT iterations see the new instances.
      const refreshed = await prisma.asset.findMany({
        where: { projectId },
      });
      ctx.parsedAssets = parseAssetsForAI(refreshed);
    }
  }

  // ── Step 2: Walk every visible DT requirement ───────────────────
  const candidates: string[] =
    ctx.raw.mechanismCandidates.length > 0
      ? (JSON.parse(ctx.raw.mechanismCandidates) as string[])
      : [];
  // Recompute via screening to pick up code-side trigger changes.
  const recomputed = evaluateScreening(ctx.screeningAnswers);
  const finalCandidates =
    recomputed.candidateMechanisms.length > 0
      ? recomputed.candidateMechanisms
      : candidates;
  const finalStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ctx.applicableStandards;

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      finalCandidates.includes(r.mechanismCode) &&
      r.standards.some((s) => finalStandards.includes(s)) &&
      evaluateRequirementApplicability(r, ctx.screeningAnswers).applies,
  );

  let totalSaved = 0;
  let reqsProcessed = 0;
  let reqsSkipped = 0;
  const errors: string[] = [];

  // Process sequentially to avoid concurrent writes to the same project.
  // Each call hits the OpenAI API; OK at 1-2s/req for ~30 reqs.
  for (const req of visibleReqs) {
    try {
      const r = await fillSingleDTRequirement(projectId, req, {
        project: ctx.project,
        parsedAssets: ctx.parsedAssets,
        screeningAnswers: ctx.screeningAnswers,
        applicableStandards: finalStandards,
        attachments: ctx.attachments,
      });
      if (r.iterationsAnswered === 0) {
        reqsSkipped++;
      } else {
        totalSaved += r.saved;
        reqsProcessed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI 호출 실패";
      errors.push(`${req.id}: ${msg}`);
      console.error(`DT AI fill error for ${req.id}:`, err);
    }
  }

  revalidatePath(`/projects/${projectId}/dt`, "layout");
  revalidatePath(`/projects/${projectId}/assets`);
  revalidatePath(`/projects/${projectId}/assets/review`);

  return {
    acmsCreated,
    authsCreated,
    sumsCreated,
    reqsProcessed,
    reqsSkipped,
    totalSaved,
    errors,
  };
}

// Toggle `userReviewed` for all DT answers in one or many iterations
// (assetId=null for the global iteration).
export async function setDTIterationReviewed(input: {
  projectId: string;
  requirementId: string;
  assetIds: Array<string | null>;
  reviewed: boolean;
}) {
  await assertProjectEditable(input.projectId);
  const now = input.reviewed ? new Date() : null;
  // Prisma doesn't support `in: [null, ...]` directly — split the call.
  const concreteIds = input.assetIds.filter(
    (a): a is string => a !== null,
  );
  const includesGlobal = input.assetIds.some((a) => a === null);

  if (concreteIds.length > 0) {
    await prisma.dTAnswer.updateMany({
      where: {
        projectId: input.projectId,
        requirementId: input.requirementId,
        assetId: { in: concreteIds },
      },
      data: { userReviewed: input.reviewed, userReviewedAt: now },
    });
  }
  if (includesGlobal) {
    await prisma.dTAnswer.updateMany({
      where: {
        projectId: input.projectId,
        requirementId: input.requirementId,
        assetId: null,
      },
      data: { userReviewed: input.reviewed, userReviewedAt: now },
    });
  }
  revalidatePath(`/projects/${input.projectId}/dt`);
  revalidatePath(`/projects/${input.projectId}/dt/${input.requirementId}`);
}

// ── Evidence (Required Information) AI fill — bulk ───────────────
export async function aiFillEvidenceAll(projectId: string) {
  await assertProjectEditable(projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      assets: true,
      dtAnswers: true,
      dtEvidences: true,
      screeningAnswers: true,
    },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (!project.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }

  const screeningAnswers: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswers[a.questionId] = a.answer;
    }
  }
  const recomputed = evaluateScreening(screeningAnswers);
  const candidates =
    recomputed.candidateMechanisms.length > 0
      ? recomputed.candidateMechanisms
      : (JSON.parse(project.mechanismCandidates) as string[]);
  const applicableStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ([
          project.applicable1 && (1 as StandardId),
          project.applicable2 && (2 as StandardId),
          project.applicable3 && (3 as StandardId),
        ].filter(Boolean) as StandardId[]);

  const parsedAssets = parseAssetsForAI(project.assets);
  const attachments = await loadProjectAttachmentsForAI(projectId);
  if (attachments.length === 0) {
    throw new Error("AI가 참고할 첨부 파일이 없습니다.");
  }
  const assetSummary = buildAssetSummary(parsedAssets);

  // Pre-index DT answers per (requirement, assetKey).
  const answersByReqAsset = new Map<string, Record<string, "yes" | "no">>();
  for (const a of project.dtAnswers) {
    const k = `${a.requirementId}::${a.assetId ?? "__global__"}`;
    const cur = answersByReqAsset.get(k) ?? {};
    if (a.answer === "yes" || a.answer === "no") cur[a.nodeId] = a.answer;
    answersByReqAsset.set(k, cur);
  }

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.some((s) => applicableStandards.includes(s)) &&
      evaluateRequirementApplicability(r, screeningAnswers).applies &&
      Array.isArray(r.evidenceFields) &&
      r.evidenceFields.length > 0,
  );

  let totalSaved = 0;
  let reqsProcessed = 0;
  const errors: string[] = [];
  const now = new Date();

  for (const req of visibleReqs) {
    try {
      // Determine iterations the same way the evidence page does.
      type IterEvid = {
        assetKey: string;
        label: string;
        metadata: Record<string, string>;
        answeredPath: Array<{ nodeId: string; answer: "yes" | "no" }>;
        applicableFields: EvidenceField[];
      };
      const iters: IterEvid[] = [];
      const dedupedKinds = req.iterateOver
        ? getApplicableKindsFor(req, DT_REQUIREMENTS, applicableStandards)
        : [];
      const iterAssets = req.iterateOver
        ? matchAssetsForRequirement(req, parsedAssets, dedupedKinds)
        : [];
      const candidates_: Array<{
        assetKey: string;
        kind: string | null;
        label: string;
        metadata: Record<string, string>;
      }> = req.iterateOver
        ? iterAssets.map((a) => ({
            assetKey: a.id,
            kind: a.kind,
            label: `${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})`,
            metadata: a.metadata,
          }))
        : [
            {
              assetKey: "__global__",
              kind: null,
              label: "기기 전체 / Global",
              metadata: {},
            },
          ];

      for (const it of candidates_) {
        // Auto-NA via naFromRequirement → skip the iteration entirely.
        if (req.naFromRequirement) {
          const linked = project.dtAnswers
            .filter(
              (d) =>
                d.requirementId === req.naFromRequirement!.requirementId &&
                (d.assetId ?? null) ===
                  (it.assetKey === "__global__" ? null : it.assetKey),
            )
            .map((d) => ({
              nodeId: d.nodeId,
              answer: d.answer as "yes" | "no",
            }));
          if (evaluateNAFromRequirement(req, linked).applies) continue;
        }

        const ans = answersByReqAsset.get(`${req.id}::${it.assetKey}`) ?? {};
        if (Object.keys(ans).length === 0) continue; // no DT answers yet

        const walk = walkTree(req, ans);
        const answeredPath = walk.path;

        const applicableFields = (req.evidenceFields ?? []).filter((f) => {
          if (
            f.scope === "per_asset" &&
            f.appliesToKinds &&
            (it.kind === null ||
              !f.appliesToKinds.includes(it.kind as never))
          ) {
            return false;
          }
          if (f.dependsOnAnswer) {
            if (ans[f.dependsOnAnswer.nodeId] !== f.dependsOnAnswer.answer)
              return false;
          }
          return true;
        });
        if (applicableFields.length === 0) continue;

        iters.push({
          assetKey: it.assetKey,
          label: it.label,
          metadata: it.metadata,
          answeredPath,
          applicableFields,
        });
      }

      if (iters.length === 0) continue;

      const validAssetKeys = iters.map((i) => i.assetKey);
      const validFieldIds = Array.from(
        new Set(iters.flatMap((i) => i.applicableFields.map((f) => f.id))),
      );

      const result = await runAIWithAttachments<EvidenceAIResult>({
        systemPrompt: EVIDENCE_SYSTEM_PROMPT,
        userPrompt: buildEvidenceUserPrompt({
          project,
          requirement: req,
          iterations: iters,
          screeningAnswers,
          assetSummary,
        }),
        attachments,
        jsonSchema: buildEvidenceJsonSchema(validAssetKeys, validFieldIds),
        schemaName: "evidence_values",
      });

      const validKeySet = new Set(validAssetKeys);
      const validFieldSet = new Set(validFieldIds);

      await prisma.$transaction(async (tx) => {
        for (const it of result.iterations) {
          if (!validKeySet.has(it.assetKey)) continue;
          const assetId = it.assetKey === "__global__" ? null : it.assetKey;

          for (const f of it.fields) {
            if (!validFieldSet.has(f.fieldId)) continue;
            // Skip if user has already reviewed this field — don't clobber.
            const existing = await tx.dTEvidence.findFirst({
              where: {
                projectId,
                assetId,
                requirementId: req.id,
                fieldId: f.fieldId,
              },
            });
            if (existing?.userReviewed) continue;

            if (existing) {
              await tx.dTEvidence.update({
                where: { id: existing.id },
                data: {
                  value: f.value,
                  aiGenerated: true,
                  aiGeneratedAt: now,
                  userReviewed: false,
                },
              });
            } else {
              await tx.dTEvidence.create({
                data: {
                  projectId,
                  assetId,
                  requirementId: req.id,
                  fieldId: f.fieldId,
                  value: f.value,
                  aiGenerated: true,
                  aiGeneratedAt: now,
                  userReviewed: false,
                },
              });
            }
            totalSaved++;
          }
        }
      });
      reqsProcessed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI 호출 실패";
      errors.push(`${req.id}: ${msg}`);
      console.error(`Evidence AI fill error for ${req.id}:`, err);
    }
  }

  revalidatePath(`/projects/${projectId}/evidence`, "layout");
  return { reqsProcessed, totalSaved, errors };
}

export async function setEvidenceReviewed(input: {
  projectId: string;
  evidenceIds: string[];
  reviewed: boolean;
}) {
  await assertProjectEditable(input.projectId);
  const now = input.reviewed ? new Date() : null;
  await prisma.dTEvidence.updateMany({
    where: {
      projectId: input.projectId,
      id: { in: input.evidenceIds },
    },
    data: { userReviewed: input.reviewed, userReviewedAt: now },
  });
  revalidatePath(`/projects/${input.projectId}/evidence`);
}

// ── Assessment (testMethod) AI fill — bulk ───────────────────────
export async function aiFillAssessmentAll(projectId: string) {
  await assertProjectEditable(projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      assets: true,
      dtAnswers: true,
      dtAssessments: true,
      screeningAnswers: true,
    },
  });
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  if (!project.screeningComplete) {
    throw new Error("먼저 스크리닝을 완료해 주세요.");
  }

  const screeningAnswers: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswers[a.questionId] = a.answer;
    }
  }
  const recomputed = evaluateScreening(screeningAnswers);
  const candidates =
    recomputed.candidateMechanisms.length > 0
      ? recomputed.candidateMechanisms
      : (JSON.parse(project.mechanismCandidates) as string[]);
  const applicableStandards =
    recomputed.applicableStandards.length > 0
      ? recomputed.applicableStandards
      : ([
          project.applicable1 && (1 as StandardId),
          project.applicable2 && (2 as StandardId),
          project.applicable3 && (3 as StandardId),
        ].filter(Boolean) as StandardId[]);

  const parsedAssets = parseAssetsForAI(project.assets);
  const attachments = await loadProjectAttachmentsForAI(projectId);
  if (attachments.length === 0) {
    throw new Error("AI가 참고할 첨부 파일이 없습니다.");
  }
  const assetSummary = buildAssetSummary(parsedAssets);

  const answersByReqAsset = new Map<string, Record<string, "yes" | "no">>();
  for (const a of project.dtAnswers) {
    const k = `${a.requirementId}::${a.assetId ?? "__global__"}`;
    const cur = answersByReqAsset.get(k) ?? {};
    if (a.answer === "yes" || a.answer === "no") cur[a.nodeId] = a.answer;
    answersByReqAsset.set(k, cur);
  }

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.some((s) => applicableStandards.includes(s)) &&
      evaluateRequirementApplicability(r, screeningAnswers).applies &&
      assessmentsFor(r.id).length > 0,
  );

  let totalSaved = 0;
  let reqsProcessed = 0;
  const errors: string[] = [];
  const now = new Date();

  for (const req of visibleReqs) {
    try {
      const types = assessmentsFor(req.id);
      type IterAssess = {
        assetKey: string;
        label: string;
        metadata: Record<string, string>;
        answeredPath: Array<{ nodeId: string; answer: "yes" | "no" }>;
        applicableTypes: AssessmentType[];
      };
      const iters: IterAssess[] = [];
      const dedupedKinds = req.iterateOver
        ? getApplicableKindsFor(req, DT_REQUIREMENTS, applicableStandards)
        : [];
      const iterAssets = req.iterateOver
        ? matchAssetsForRequirement(req, parsedAssets, dedupedKinds)
        : [];
      const candidates_ = req.iterateOver
        ? iterAssets.map((a) => ({
            assetKey: a.id,
            label: `${a.name} (${kindConfig(a.kind)?.title_ko ?? a.kind})`,
            metadata: a.metadata,
          }))
        : [
            {
              assetKey: "__global__",
              label: "기기 전체 / Global",
              metadata: {},
            },
          ];

      for (const it of candidates_) {
        // Auto-NA via naFromRequirement → skip.
        if (req.naFromRequirement) {
          const linked = project.dtAnswers
            .filter(
              (d) =>
                d.requirementId === req.naFromRequirement!.requirementId &&
                (d.assetId ?? null) ===
                  (it.assetKey === "__global__" ? null : it.assetKey),
            )
            .map((d) => ({
              nodeId: d.nodeId,
              answer: d.answer as "yes" | "no",
            }));
          if (evaluateNAFromRequirement(req, linked).applies) continue;
        }

        // Only evaluate iterations whose DT outcome is PASS or FAIL — the
        // assessment page hides NA/incomplete iterations.
        const ans = answersByReqAsset.get(`${req.id}::${it.assetKey}`) ?? {};
        if (Object.keys(ans).length === 0) continue;
        const walk = walkTree(req, ans);
        if (walk.kind !== "outcome") continue;
        if (walk.outcome === "not_applicable") continue;

        iters.push({
          assetKey: it.assetKey,
          label: it.label,
          metadata: it.metadata,
          answeredPath: walk.path,
          applicableTypes: types,
        });
      }

      if (iters.length === 0) continue;

      const validAssetKeys = iters.map((i) => i.assetKey);

      const result = await runAIWithAttachments<AssessmentAIResult>({
        systemPrompt: ASSESSMENT_SYSTEM_PROMPT,
        userPrompt: buildAssessmentUserPrompt({
          project,
          requirement: req,
          iterations: iters,
          screeningAnswers,
          assetSummary,
        }),
        attachments,
        jsonSchema: buildAssessmentJsonSchema(validAssetKeys, types),
        schemaName: "assessment_methods",
      });

      const validKeySet = new Set(validAssetKeys);
      const validTypeSet = new Set(types);

      await prisma.$transaction(async (tx) => {
        for (const it of result.iterations) {
          if (!validKeySet.has(it.assetKey)) continue;
          const assetId = it.assetKey === "__global__" ? null : it.assetKey;

          for (const m of it.methods) {
            if (!validTypeSet.has(m.type)) continue;
            // Skip if user has already reviewed this assessment record.
            const existing = await tx.dTAssessment.findFirst({
              where: {
                projectId,
                assetId,
                requirementId: req.id,
                assessmentType: m.type,
              },
            });
            if (existing?.userReviewed) continue;

            if (existing) {
              await tx.dTAssessment.update({
                where: { id: existing.id },
                data: {
                  testMethod: m.testMethod,
                  aiGenerated: true,
                  aiGeneratedAt: now,
                  userReviewed: false,
                },
              });
            } else {
              await tx.dTAssessment.create({
                data: {
                  projectId,
                  assetId,
                  requirementId: req.id,
                  assessmentType: m.type,
                  testMethod: m.testMethod,
                  testResult: "",
                  aiGenerated: true,
                  aiGeneratedAt: now,
                  userReviewed: false,
                },
              });
            }
            totalSaved++;
          }
        }
      });
      reqsProcessed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI 호출 실패";
      errors.push(`${req.id}: ${msg}`);
      console.error(`Assessment AI fill error for ${req.id}:`, err);
    }
  }

  revalidatePath(`/projects/${projectId}/assessment`, "layout");
  return { reqsProcessed, totalSaved, errors };
}

export async function setAssessmentReviewed(input: {
  projectId: string;
  assessmentIds: string[];
  reviewed: boolean;
}) {
  await assertProjectEditable(input.projectId);
  const now = input.reviewed ? new Date() : null;
  await prisma.dTAssessment.updateMany({
    where: {
      projectId: input.projectId,
      id: { in: input.assessmentIds },
    },
    data: { userReviewed: input.reviewed, userReviewedAt: now },
  });
  revalidatePath(`/projects/${input.projectId}/assessment`);
}

// Bulk-mark all AI-generated unreviewed DT answers as reviewed.
export async function setAllAIDTAnswersReviewed(projectId: string) {
  await assertProjectEditable(projectId);
  await prisma.dTAnswer.updateMany({
    where: { projectId, aiGenerated: true, userReviewed: false },
    data: { userReviewed: true, userReviewedAt: new Date() },
  });
  revalidatePath(`/projects/${projectId}/dt`);
}

// Bulk-mark all AI-generated unreviewed evidence fields as reviewed.
export async function setAllAIEvidenceReviewed(projectId: string) {
  await assertProjectEditable(projectId);
  await prisma.dTEvidence.updateMany({
    where: { projectId, aiGenerated: true, userReviewed: false },
    data: { userReviewed: true, userReviewedAt: new Date() },
  });
  revalidatePath(`/projects/${projectId}/evidence`, "layout");
}
