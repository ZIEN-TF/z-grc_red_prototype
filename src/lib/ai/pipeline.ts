// "AI 전체 자동 수행" pipeline. Runs server-side as a background job after the
// user presses the button on /result. Order follows the standard's dependency
// chain: firmware analysis (once) → assets → DT answers → evidence → assessment.
// All outputs are flagged aiGenerated for human review; nothing is finalized.
//
// One firmware analysis is reused across every call. The static grounding block
// (instruction + definitions + firmware findings) is identical across calls in a
// run, so prompt caching makes the ~dozens of per-requirement calls cheap.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  DT_REQUIREMENTS,
  requirementById,
  assessmentsFor,
  evaluateRequirementApplicability,
  matchAssetsForRequirement,
  getApplicableKindsFor,
  type DTRequirement,
  type AssessmentType,
} from "@/lib/decision-trees";
import { definitionsBlock, requirementGrounding, GROUNDING_INSTRUCTION } from "./standard-context";
import { type StandardId } from "@/lib/mechanisms";
import { applicableAssetKinds } from "@/lib/asset-kinds";
import { callStructured } from "./anthropic";
import { runFirmwareAnalysis, findingsToText, parseFindings, type FirmwareFindings } from "./firmware";

// Inventory asset kinds the AI may create (instance kinds are derived later by
// the existing DT flow, not by asset identification).
const CREATABLE_KINDS = [
  "security_asset",
  "network_asset",
  "privacy_asset",
  "financial_asset",
  "network_interface",
  "network_service",
  "physical_interface",
] as const;

const AssetsSchema = z.object({
  assets: z.array(
    z.object({
      kind: z.enum(CREATABLE_KINDS),
      name: z.string(),
      description: z.string(),
      // kind-specific metadata as a JSON object string (e.g. {"type":"key"}).
      metadataJson: z.string(),
    }),
  ),
});

const DTSchema = z.object({
  iterations: z.array(
    z.object({
      assetName: z.string().nullable(), // null for global (non per-asset) requirements
      answers: z.array(
        z.object({
          nodeId: z.string(),
          answer: z.enum(["yes", "no", "na"]),
        }),
      ),
    }),
  ),
});

const EvidenceSchema = z.object({
  fields: z.array(
    z.object({
      assetName: z.string().nullable(),
      fieldId: z.string(),
      value: z.string(),
    }),
  ),
});

const AssessmentSchema = z.object({
  assessments: z.array(
    z.object({
      type: z.enum(["completeness", "sufficiency", "conceptual_completeness"]),
      testMethod: z.string(),
      testResult: z.string(),
      verdict: z.enum(["pass", "fail", "not_applicable"]),
      // false when the check requires the physical device / dynamic testing.
      aiPerformable: z.boolean(),
    }),
  ),
});

type ParsedAsset = { id: string; kind: string; name: string; metadata: Record<string, string> };

function safeMeta(s: string): Record<string, string> {
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

// ── progress helpers ─────────────────────────────────────────────
async function setStep(runId: string, step: string, total: number, message: string) {
  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { step, total, completed: 0, message },
  });
}
async function tick(runId: string, message: string) {
  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { completed: { increment: 1 }, message },
  });
}

// Requirements in scope: mechanism is a screening candidate, the requirement's
// standard is applicable, and screening-level applicability holds.
function scopedRequirements(
  candidates: string[],
  applicable: StandardId[],
  screening: Record<string, "yes" | "no">,
): DTRequirement[] {
  return DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.some((s) => applicable.includes(s)) &&
      evaluateRequirementApplicability(r, screening).applies,
  );
}

export async function runPipeline(runId: string): Promise<void> {
  try {
    const run = await prisma.aiPipelineRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const projectId = run.projectId;

    await prisma.aiPipelineRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: new Date(), step: "firmware", message: "펌웨어 분석 준비 중…" },
    });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { screeningAnswers: true },
    });
    if (!project) throw new Error("Project not found");

    const candidates: string[] = JSON.parse(project.mechanismCandidates);
    const applicable: StandardId[] = [];
    if (project.applicable1) applicable.push(1);
    if (project.applicable2) applicable.push(2);
    if (project.applicable3) applicable.push(3);
    const screening: Record<string, "yes" | "no"> = {};
    for (const a of project.screeningAnswers) {
      if (a.answer === "yes" || a.answer === "no") screening[a.questionId] = a.answer;
    }

    // ── Firmware analysis (once; reuse if already done) ──
    let findings: FirmwareFindings | null = null;
    const existing = await prisma.firmwareAnalysis.findFirst({
      where: { projectId, status: "done" },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.findings) {
      findings = parseFindings(existing.findings);
    }
    if (!findings) {
      const fa = await prisma.firmwareAnalysis.create({ data: { projectId } });
      await prisma.aiPipelineRun.update({
        where: { id: runId },
        data: { step: "firmware", message: "펌웨어 추출·분석 중 (binwalk)…" },
      });
      findings = await runFirmwareAnalysis(fa.id);
    }

    // Static grounding block — identical across all calls in this run → cached.
    const baseSystem = [
      GROUNDING_INSTRUCTION,
      "# Firmware analysis findings\n" + findingsToText(findings),
      ...applicable.map((s) => definitionsBlock(s)),
    ].join("\n\n");

    const reqs = scopedRequirements(candidates, applicable, screening);

    // ── Stage 1: asset identification ──
    await setStep(runId, "assets", 1, "AI가 펌웨어에서 자산을 식별하는 중…");
    const allowedKinds = new Set(applicableAssetKinds(applicable).map((k) => k.kind));
    const assetsRes = await callStructured({
      system: baseSystem,
      user:
        "Identify the EN 18031 assets present in this device from the firmware findings and attachments.\n" +
        `Only use these asset kinds (skip others): ${[...allowedKinds].join(", ")}.\n` +
        "For each asset give: kind, a short name, a description, and metadataJson (a JSON object of kind-specific attributes; use {} if unsure). " +
        "Be concrete and grounded in the findings; do not invent assets with no evidence.",
      schema: AssetsSchema,
      schemaName: "assets",
      effort: "medium",
    });
    // Replace prior AI-generated assets to keep the run idempotent.
    await prisma.asset.deleteMany({ where: { projectId, aiGenerated: true } });
    for (const a of assetsRes.assets) {
      if (!allowedKinds.has(a.kind)) continue;
      await prisma.asset.create({
        data: {
          projectId,
          kind: a.kind,
          name: a.name.trim() || "(unnamed)",
          description: a.description?.trim() || null,
          metadata: JSON.stringify(safeMeta(a.metadataJson)),
          aiGenerated: true,
          aiGeneratedAt: new Date(),
        },
      });
    }
    await tick(runId, "자산 식별 완료");

    // Reload assets for iteration matching.
    const dbAssets = await prisma.asset.findMany({ where: { projectId } });
    const parsedAssets: ParsedAsset[] = dbAssets.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      metadata: safeMeta(a.metadata),
    }));

    // ── Stage 2: decision-tree answers ──
    await setStep(runId, "dt", reqs.length, "AI가 Decision Tree를 채우는 중…");
    for (const req of reqs) {
      try {
        const matched = req.iterateOver
          ? matchAssetsForRequirement(
              req,
              parsedAssets,
              getApplicableKindsFor(req, DT_REQUIREMENTS, applicable),
            )
          : [];
        const dtRes = await callStructured({
          system: baseSystem,
          user:
            requirementGrounding(req.id, assessmentsFor(req.id)) +
            "\n\n## Task\nAnswer this requirement's decision tree" +
            (req.iterateOver
              ? `, once per asset below (use assetName exactly). Assets:\n${matched.map((a) => `- ${a.name}`).join("\n") || "(no matching assets — return empty iterations)"}`
              : " as a single global iteration (assetName = null).") +
            "\nFor each iteration return the node answers (yes/no/na) along a valid path from the root. Base answers on the firmware findings.",
          schema: DTSchema,
          schemaName: "dt_answers",
          effort: "medium",
        });
        const nameToId = new Map(matched.map((a) => [a.name, a.id]));
        for (const it of dtRes.iterations) {
          const assetId = req.iterateOver ? (it.assetName ? nameToId.get(it.assetName) ?? null : null) : null;
          if (req.iterateOver && !assetId) continue; // skip unmatched
          await prisma.dTAnswer.deleteMany({
            where: { projectId, assetId, requirementId: req.id },
          });
          await prisma.dTAnswer.createMany({
            data: it.answers
              .filter((n) => req.nodes[n.nodeId])
              .map((n) => ({
                projectId,
                assetId,
                mechanismCode: req.mechanismCode,
                requirementId: req.id,
                nodeId: n.nodeId,
                answer: n.answer,
                aiGenerated: true,
                aiGeneratedAt: new Date(),
              })),
          });
        }
      } catch (err) {
        await recordError(runId, `DT ${req.id}: ${msg(err)}`);
      }
      await tick(runId, `DT 평가 ${req.id}`);
    }

    // ── Stage 3: evidence (required information) ──
    const evReqs = reqs.filter((r) => r.evidenceFields && r.evidenceFields.length > 0);
    await setStep(runId, "evidence", evReqs.length, "AI가 증빙 정보를 채우는 중…");
    for (const req of evReqs) {
      try {
        const matched = req.iterateOver
          ? matchAssetsForRequirement(
              req,
              parsedAssets,
              getApplicableKindsFor(req, DT_REQUIREMENTS, applicable),
            )
          : [];
        const fieldList = (req.evidenceFields ?? [])
          .map((f) => `- ${f.id} (${f.scope}): ${f.prompt_en}`)
          .join("\n");
        const evRes = await callStructured({
          system: baseSystem,
          user:
            requirementGrounding(req.id, assessmentsFor(req.id)) +
            "\n\n## Task\nFill the required-information fields below from the firmware findings.\n" +
            `Fields:\n${fieldList}\n` +
            (req.iterateOver
              ? `For per_asset fields, set assetName to one of: ${matched.map((a) => a.name).join(", ") || "(none)"}. For requirement-level fields use assetName=null.`
              : "All fields are requirement-level; use assetName=null.") +
            "\nLeave value empty if not determinable from the findings.",
          schema: EvidenceSchema,
          schemaName: "evidence",
          effort: "low",
        });
        const nameToId = new Map(matched.map((a) => [a.name, a.id]));
        for (const f of evRes.fields) {
          if (!f.value.trim()) continue;
          const fieldSpec = (req.evidenceFields ?? []).find((x) => x.id === f.fieldId);
          if (!fieldSpec) continue;
          const assetId =
            fieldSpec.scope === "per_asset" && f.assetName ? nameToId.get(f.assetName) ?? null : null;
          const existingEv = await prisma.dTEvidence.findFirst({
            where: { projectId, assetId, requirementId: req.id, fieldId: f.fieldId },
          });
          if (existingEv) {
            await prisma.dTEvidence.update({
              where: { id: existingEv.id },
              data: { value: f.value, aiGenerated: true, aiGeneratedAt: new Date() },
            });
          } else {
            await prisma.dTEvidence.create({
              data: {
                projectId,
                assetId,
                requirementId: req.id,
                fieldId: f.fieldId,
                value: f.value,
                aiGenerated: true,
                aiGeneratedAt: new Date(),
              },
            });
          }
        }
      } catch (err) {
        await recordError(runId, `Evidence ${req.id}: ${msg(err)}`);
      }
      await tick(runId, `증빙 ${req.id}`);
    }

    // ── Stage 4: functional assessment ──
    const asReqs = reqs.filter((r) => assessmentsFor(r.id).length > 0);
    await setStep(runId, "assessment", asReqs.length, "AI가 기능 평가를 수행하는 중…");
    for (const req of asReqs) {
      const types = assessmentsFor(req.id);
      try {
        const asRes = await callStructured({
          system: baseSystem,
          user:
            requirementGrounding(req.id, types) +
            "\n\n## Task\nFor each assessment type below, perform the assessment using the firmware findings and the assessment units.\n" +
            `Assessment types: ${types.join(", ")}.\n` +
            "Write testMethod (device-specific steps derived from the assessment units), testResult (what you found), and verdict (pass/fail/not_applicable) applying the verdict criteria.\n" +
            "Set aiPerformable=false when the check requires running the physical device (dynamic testing) — in that case put the testMethod a human should follow into testMethod and leave the actual result for a human.",
          schema: AssessmentSchema,
          schemaName: "assessment",
          effort: "high",
        });
        for (const a of asRes.assessments) {
          if (!types.includes(a.type as AssessmentType)) continue;
          let testResult = a.testResult?.trim() ?? "";
          if (!a.aiPerformable) {
            testResult = `AI 수행 불가 — 실기기 동적 테스트 필요.\n${testResult}`.trim();
          }
          const existingAs = await prisma.dTAssessment.findFirst({
            where: { projectId, assetId: null, requirementId: req.id, assessmentType: a.type },
          });
          const data = {
            testMethod: a.testMethod?.trim() ?? "",
            testResult,
            verdict: a.aiPerformable ? a.verdict : null,
            aiGenerated: true,
            aiGeneratedAt: new Date(),
          };
          if (existingAs) {
            await prisma.dTAssessment.update({ where: { id: existingAs.id }, data });
          } else {
            await prisma.dTAssessment.create({
              data: { projectId, assetId: null, requirementId: req.id, assessmentType: a.type, ...data },
            });
          }
        }
      } catch (err) {
        await recordError(runId, `Assessment ${req.id}: ${msg(err)}`);
      }
      await tick(runId, `기능평가 ${req.id}`);
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
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function recordError(runId: string, line: string) {
  const run = await prisma.aiPipelineRun.findUnique({ where: { id: runId } });
  const prev = run?.error ?? "";
  await prisma.aiPipelineRun.update({
    where: { id: runId },
    data: { error: (prev ? prev + "\n" : "") + line },
  });
}
