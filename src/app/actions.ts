"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  evaluateScreening,
  type ScreeningAnswerMap,
} from "@/lib/screening-questions";
import {
  requireSession,
  requireConsultant,
  requireProjectAccess,
} from "@/lib/auth";

// File upload constraints for project attachments
const ATTACHMENT_MAX_SIZE = 50 * 1024 * 1024; // 50MB
const ATTACHMENT_ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

function sanitizeFilename(name: string): string {
  // Replace path separators / control chars with "_" but keep unicode (incl. Korean).
  return name.replace(/[/\\?*:|"<>\x00-\x1F]/g, "_").slice(0, 200);
}

// Throws if the project is finalized (locked for edits).
async function assertNotFinalized(projectId: string) {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { finalizedAt: true },
  });
  if (p?.finalizedAt) {
    throw new Error(
      "리포트가 확정된 프로젝트는 수정할 수 없습니다. 먼저 확정을 해제하세요.",
    );
  }
}

// Composed guard: check access + not-finalized.
async function assertProjectEditable(projectId: string) {
  await requireProjectAccess(projectId);
  await assertNotFinalized(projectId);
}

async function writeAttachments(
  projectId: string,
  formData: FormData,
): Promise<void> {
  const files = formData.getAll("attachments").filter((f) => f instanceof File) as File[];
  const descriptions = formData.getAll("descriptions").map((d) => String(d));

  const dir = path.join(process.cwd(), "uploads", projectId);
  let dirCreated = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || file.size === 0) continue; // empty slot
    if (!ATTACHMENT_ALLOWED_MIMES.has(file.type)) {
      throw new Error(`지원하지 않는 파일 형식: ${file.name} (${file.type})`);
    }
    if (file.size > ATTACHMENT_MAX_SIZE) {
      throw new Error(`파일 크기 초과: ${file.name} (최대 50MB)`);
    }
    if (!dirCreated) {
      await fs.mkdir(dir, { recursive: true });
      dirCreated = true;
    }
    const uniquePrefix = crypto.randomUUID();
    const safeName = sanitizeFilename(file.name);
    const storedPath = path.posix.join(projectId, `${uniquePrefix}-${safeName}`);
    const fullPath = path.join(process.cwd(), "uploads", storedPath);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(fullPath, buffer);
    await prisma.projectAttachment.create({
      data: {
        projectId,
        filename: file.name,
        storedPath,
        mimeType: file.type,
        size: buffer.length,
        description: (descriptions[i] ?? "").trim(),
      },
    });
  }
}

export async function createProject(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const manufacturer = String(formData.get("manufacturer") ?? "").trim();
  if (!name) throw new Error("제품명을 입력하세요.");
  if (!manufacturer) throw new Error("제조사를 입력하세요.");

  const project = await prisma.project.create({
    data: {
      name,
      manufacturer,
      contactName: String(formData.get("contactName") ?? "").trim() || null,
      contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
      productType: String(formData.get("productType") ?? "").trim() || null,
      productDescription:
        String(formData.get("productDescription") ?? "").trim() || null,
      userId: session.userId,
    },
  });

  try {
    await writeAttachments(project.id, formData);
  } catch (err) {
    // If attachment upload fails mid-way, project still exists; re-throw so user sees the message.
    // The user can still proceed to screening and manage attachments later.
    console.error("Attachment upload failed:", err);
    throw err;
  }

  revalidatePath("/");
  redirect(`/projects/${project.id}/screening`);
}

export async function deleteProject(id: string) {
  await requireProjectAccess(id);
  // Remove project's uploaded files from disk (best-effort)
  const dir = path.join(process.cwd(), "uploads", id);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await prisma.project.delete({ where: { id } });
  revalidatePath("/");
}

export async function addProjectAttachments(
  projectId: string,
  formData: FormData,
) {
  await requireProjectAccess(projectId);
  await assertProjectEditable(projectId);
  await writeAttachments(projectId, formData);
  revalidatePath(`/projects/${projectId}/attachments`);
}

export async function deleteProjectAttachment(input: {
  projectId: string;
  attachmentId: string;
}) {
  await requireProjectAccess(input.projectId);
  await assertProjectEditable(input.projectId);
  const att = await prisma.projectAttachment.findUnique({
    where: { id: input.attachmentId },
  });
  if (!att || att.projectId !== input.projectId) return;
  await prisma.projectAttachment.delete({ where: { id: input.attachmentId } });
  const fullPath = path.join(process.cwd(), "uploads", att.storedPath);
  await fs.unlink(fullPath).catch(() => {});
  revalidatePath(`/projects/${input.projectId}/attachments`);
}

export type NewAssetInput = {
  projectId: string;
  kind: string;
  name: string;
  description?: string;
  metadata?: Record<string, string>;
};

export async function createAsset(input: NewAssetInput) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: input.kind,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
  revalidatePath(`/projects/${input.projectId}/assets`);
  revalidatePath("/");
}

export async function deleteAsset(id: string, projectId: string) {
  await assertProjectEditable(projectId);
  await prisma.asset.delete({ where: { id } });
  revalidatePath(`/projects/${projectId}/assets`);
  revalidatePath(`/projects/${projectId}/assets/review`);
  revalidatePath("/");
}

export type UpdateAssetInput = {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  metadata?: Record<string, string>;
};

export async function updateAsset(input: UpdateAssetInput) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.update({
    where: { id: input.id },
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
  revalidatePath(`/projects/${input.projectId}/assets`);
  revalidatePath(`/projects/${input.projectId}/assets/review`);
}

// ── ACM instances (named inline from ACM-2 DT) ────────────────────
export type AcmPasswordType =
  | "factory_default"
  | "user_set"
  | "third_party"
  | "none"
  | "";

export type AcmInstanceInput = {
  projectId: string;
  name: string;
  interfaceNetwork: boolean;
  interfaceUser: boolean;
  interfaceMachine: boolean;
  passwordType: AcmPasswordType; // empty = unanswered
};

function acmMetadata(input: Omit<AcmInstanceInput, "projectId" | "name">): string {
  return JSON.stringify({
    interface_network: input.interfaceNetwork ? "yes" : "no",
    interface_user: input.interfaceUser ? "yes" : "no",
    interface_machine: input.interfaceMachine ? "yes" : "no",
    password_type: input.passwordType,
  });
}

export async function createAcmInstance(input: AcmInstanceInput): Promise<{ id: string }> {
  await assertProjectEditable(input.projectId);
  const row = await prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "acm_instance",
      name: input.name.trim() || "(이름 없음)",
      metadata: acmMetadata(input),
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
  return { id: row.id };
}

export async function updateAcmInstance(
  input: AcmInstanceInput & { id: string },
) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.update({
    where: { id: input.id },
    data: {
      name: input.name.trim() || "(이름 없음)",
      metadata: acmMetadata(input),
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
}

export async function deleteAcmInstance(input: {
  projectId: string;
  id: string;
}) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.delete({ where: { id: input.id } });
  revalidatePath(`/projects/${input.projectId}/dt`);
}

// ── SUM instances (named inline from SUM-1 DT when PASS) ──────────
export async function createSumInstance(input: {
  projectId: string;
  name: string;
}): Promise<{ id: string }> {
  await assertProjectEditable(input.projectId);
  const row = await prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "sum_instance",
      name: input.name.trim() || "(이름 없음)",
      metadata: "{}",
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
  return { id: row.id };
}

export async function updateSumInstance(input: {
  projectId: string;
  id: string;
  name: string;
}) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.update({
    where: { id: input.id },
    data: { name: input.name.trim() || "(이름 없음)" },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
}

export async function deleteSumInstance(input: {
  projectId: string;
  id: string;
}) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.delete({ where: { id: input.id } });
  revalidatePath(`/projects/${input.projectId}/dt`);
}

// ── Authenticator instances (named inline from AUM-2 DT when PASS) ──
export type AuthType =
  | "password"
  | "pin"
  | "biometric"
  | "certificate"
  | "network_trust"
  | "other"
  | "";

export type PasswordSubtype =
  | "factory_default"
  | "user_set"
  | "third_party"
  | "none"
  | "";

export async function createAuthenticatorInstance(input: {
  projectId: string;
  acmId: string;
  name: string;
  authType: AuthType;
  passwordSubtype: PasswordSubtype;
}): Promise<{ id: string }> {
  await assertProjectEditable(input.projectId);
  const row = await prisma.asset.create({
    data: {
      projectId: input.projectId,
      kind: "authenticator_instance",
      name: input.name.trim() || "(이름 없음)",
      metadata: JSON.stringify({
        acmId: input.acmId,
        authType: input.authType,
        passwordSubtype: input.passwordSubtype,
      }),
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
  return { id: row.id };
}

export async function updateAuthenticatorInstance(input: {
  id: string;
  projectId: string;
  acmId: string;
  name: string;
  authType: AuthType;
  passwordSubtype: PasswordSubtype;
}) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.update({
    where: { id: input.id },
    data: {
      name: input.name.trim() || "(이름 없음)",
      metadata: JSON.stringify({
        acmId: input.acmId,
        authType: input.authType,
        passwordSubtype: input.passwordSubtype,
      }),
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
}

export async function deleteAuthenticatorInstance(input: {
  projectId: string;
  id: string;
}) {
  await assertProjectEditable(input.projectId);
  await prisma.asset.delete({ where: { id: input.id } });
  revalidatePath(`/projects/${input.projectId}/dt`);
}

// Save a single DT node answer. Upserts manually because SQLite treats NULLs
// as distinct in unique indexes (would prevent upsert for global requirements).
export async function saveDTNodeAnswer(input: {
  projectId: string;
  assetId: string | null;
  mechanismCode: string;
  requirementId: string;
  nodeId: string;
  answer: "yes" | "no";
  notes?: string;
}) {
  await assertProjectEditable(input.projectId);
  const existing = await prisma.dTAnswer.findFirst({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
      nodeId: input.nodeId,
    },
  });
  if (existing) {
    await prisma.dTAnswer.update({
      where: { id: existing.id },
      data: {
        answer: input.answer,
        notes: input.notes?.trim() || null,
      },
    });
  } else {
    await prisma.dTAnswer.create({
      data: {
        projectId: input.projectId,
        assetId: input.assetId,
        mechanismCode: input.mechanismCode,
        requirementId: input.requirementId,
        nodeId: input.nodeId,
        answer: input.answer,
        notes: input.notes?.trim() || null,
      },
    });
  }
  revalidatePath(`/projects/${input.projectId}/dt`);
  revalidatePath(`/projects/${input.projectId}/dt/${input.requirementId}`);
  revalidatePath("/");
}

// When the user changes an earlier answer, we must discard subsequent answers
// because the new path may diverge. This deletes `nodeId` and all answers
// recorded after it for the same (asset, requirement).
export async function revertDTNodeAndAfter(input: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
  fromNodeId: string; // inclusive — remove this node and anything after
  afterNodeIds: string[]; // node ids in the prior path that come AFTER fromNodeId
}) {
  await assertProjectEditable(input.projectId);
  const ids = [input.fromNodeId, ...input.afterNodeIds];
  await prisma.dTAnswer.deleteMany({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
      nodeId: { in: ids },
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
  revalidatePath(`/projects/${input.projectId}/dt/${input.requirementId}`);
}

// Copy answers from one requirement to another (the UI exposes this for
// requirements whose DT node structure is identical — see `sameAs`).
// Assets that do not match the target requirement's iteration scope are skipped,
// so e.g. a Part-1 `network_asset` answer is not copied to a Part-2 requirement
// that only iterates `privacy_asset`.
export async function copyDTAnswersFrom(input: {
  projectId: string;
  fromRequirementId: string;
  toRequirementId: string;
}) {
  await assertProjectEditable(input.projectId);
  const { requirementById, matchAssetsForRequirement } = await import(
    "@/lib/decision-trees"
  );
  const fromReq = requirementById(input.fromRequirementId);
  const toReq = requirementById(input.toRequirementId);
  if (!fromReq || !toReq) throw new Error("Requirement not found");

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    include: { assets: true },
  });
  if (!project) throw new Error("Project not found");

  const parsedAssets = project.assets.map((a) => {
    let metadata: Record<string, string> = {};
    try {
      const parsed = JSON.parse(a.metadata);
      if (parsed && typeof parsed === "object")
        metadata = parsed as Record<string, string>;
    } catch {}
    return { id: a.id, kind: a.kind, metadata };
  });

  const targetAssetIds = toReq.iterateOver
    ? new Set(matchAssetsForRequirement(toReq, parsedAssets).map((a) => a.id))
    : null;

  const fromAnswers = await prisma.dTAnswer.findMany({
    where: { projectId: input.projectId, requirementId: fromReq.id },
  });

  let copied = 0;
  await prisma.$transaction(async (tx) => {
    for (const a of fromAnswers) {
      // Skip nodes that don't exist in the target DT
      if (!toReq.nodes[a.nodeId]) continue;
      // Global vs per-asset scope must match
      if (toReq.iterateOver) {
        if (a.assetId === null) continue;
        if (!targetAssetIds!.has(a.assetId)) continue;
      } else {
        if (a.assetId !== null) continue;
      }

      // Upsert manually (SQLite NULL handling)
      const existing = await tx.dTAnswer.findFirst({
        where: {
          projectId: input.projectId,
          assetId: a.assetId,
          requirementId: toReq.id,
          nodeId: a.nodeId,
        },
      });
      if (existing) {
        await tx.dTAnswer.update({
          where: { id: existing.id },
          data: { answer: a.answer, notes: a.notes },
        });
      } else {
        await tx.dTAnswer.create({
          data: {
            projectId: input.projectId,
            assetId: a.assetId,
            mechanismCode: toReq.mechanismCode,
            requirementId: toReq.id,
            nodeId: a.nodeId,
            answer: a.answer,
            notes: a.notes,
          },
        });
      }
      copied++;
    }
  });

  revalidatePath(`/projects/${input.projectId}/dt`);
  revalidatePath(`/projects/${input.projectId}/dt/${toReq.id}`);
  return { copied };
}

// ── Structured evidence (DTEvidence) ──────────────────────────────
export async function saveDTEvidence(input: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
  fieldId: string;
  value: string;
}) {
  await assertProjectEditable(input.projectId);
  const existing = await prisma.dTEvidence.findFirst({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
      fieldId: input.fieldId,
    },
  });
  if (existing) {
    await prisma.dTEvidence.update({
      where: { id: existing.id },
      data: { value: input.value },
    });
  } else {
    await prisma.dTEvidence.create({
      data: {
        projectId: input.projectId,
        assetId: input.assetId,
        requirementId: input.requirementId,
        fieldId: input.fieldId,
        value: input.value,
      },
    });
  }
  revalidatePath(`/projects/${input.projectId}/evidence`);
}

export async function resetDTEvaluation(input: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
}) {
  await assertProjectEditable(input.projectId);
  await prisma.dTAnswer.deleteMany({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
    },
  });
  revalidatePath(`/projects/${input.projectId}/dt`);
  revalidatePath(`/projects/${input.projectId}/dt/${input.requirementId}`);
}

// ── Technical assessment (DTAssessment) ──────────────────────────
export type AssessmentVerdict = "pass" | "fail" | "not_applicable";

export async function saveDTAssessment(input: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
  assessmentType: string; // "completeness" | "sufficiency" | "conceptual_completeness"
  testMethod?: string;
  testResult?: string;
  verdict?: AssessmentVerdict | null;
}) {
  await requireConsultant();
  await assertNotFinalized(input.projectId);
  const existing = await prisma.dTAssessment.findFirst({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
      assessmentType: input.assessmentType,
    },
  });
  const data = {
    testMethod: input.testMethod ?? "",
    testResult: input.testResult ?? "",
    verdict: input.verdict ?? null,
  };
  if (existing) {
    await prisma.dTAssessment.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.dTAssessment.create({
      data: {
        projectId: input.projectId,
        assetId: input.assetId,
        requirementId: input.requirementId,
        assessmentType: input.assessmentType,
        ...data,
      },
    });
  }
  revalidatePath(`/projects/${input.projectId}/assessment`);
}

export async function saveScreening(
  projectId: string,
  answers: ScreeningAnswerMap,
) {
  await assertProjectEditable(projectId);
  const result = evaluateScreening(answers);

  await prisma.$transaction(async (tx) => {
    // Replace answers
    await tx.screeningAnswer.deleteMany({ where: { projectId } });
    await tx.screeningAnswer.createMany({
      data: Object.entries(answers).map(([questionId, answer]) => ({
        projectId,
        questionId,
        answer,
      })),
    });
    await tx.project.update({
      where: { id: projectId },
      data: {
        applicable1: result.applicableStandards.includes(1),
        applicable2: result.applicableStandards.includes(2),
        applicable3: result.applicableStandards.includes(3),
        mechanismCandidates: JSON.stringify(result.candidateMechanisms),
        screeningComplete: true,
      },
    });
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}/result`);
}

// ── Finalize / Unlock ─────────────────────────────────────────────
export async function finalizeProject(input: {
  projectId: string;
  finalizedBy?: string;
  note?: string;
}) {
  await requireConsultant();
  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      finalizedAt: new Date(),
      finalizedBy: input.finalizedBy?.trim() || null,
      finalizedNote: input.note?.trim() || null,
    },
  });
  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath(`/projects/${input.projectId}/report`);
  revalidatePath("/");
}

export async function unlockProject(projectId: string) {
  await requireConsultant();
  await prisma.project.update({
    where: { id: projectId },
    data: {
      finalizedAt: null,
      finalizedBy: null,
      finalizedNote: null,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/report`);
  revalidatePath("/");
}

// ── Assessment attachment (one file per assessment) ───────────────
export async function uploadAssessmentAttachment(input: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
  assessmentType: string;
  formData: FormData;
}) {
  await requireConsultant();
  await assertNotFinalized(input.projectId);
  const file = input.formData.get("file") as File | null;
  if (!file || file.size === 0) {
    throw new Error("파일을 선택하세요.");
  }
  if (!ATTACHMENT_ALLOWED_MIMES.has(file.type)) {
    throw new Error(`지원하지 않는 파일 형식: ${file.type}`);
  }
  if (file.size > ATTACHMENT_MAX_SIZE) {
    throw new Error(`파일 크기 초과: ${file.name} (최대 50MB)`);
  }

  // Find or create the assessment record
  const existing = await prisma.dTAssessment.findFirst({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
      assessmentType: input.assessmentType,
    },
  });

  // If there's a previous attachment, delete it from disk
  if (existing?.attachmentStoredPath) {
    const oldPath = path.join(process.cwd(), "uploads", existing.attachmentStoredPath);
    await fs.unlink(oldPath).catch(() => {});
  }

  // Write new file
  const dir = path.join(process.cwd(), "uploads", input.projectId, "assessments");
  await fs.mkdir(dir, { recursive: true });
  const uniquePrefix = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const storedPath = path.posix.join(
    input.projectId,
    "assessments",
    `${uniquePrefix}-${safeName}`,
  );
  const fullPath = path.join(process.cwd(), "uploads", storedPath);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  const data = {
    attachmentFilename: file.name,
    attachmentStoredPath: storedPath,
    attachmentMimeType: file.type,
    attachmentSize: buffer.length,
  };

  if (existing) {
    await prisma.dTAssessment.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.dTAssessment.create({
      data: {
        projectId: input.projectId,
        assetId: input.assetId,
        requirementId: input.requirementId,
        assessmentType: input.assessmentType,
        ...data,
      },
    });
  }
  revalidatePath(`/projects/${input.projectId}/assessment`);
}

export async function deleteAssessmentAttachment(input: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
  assessmentType: string;
}) {
  await requireConsultant();
  await assertNotFinalized(input.projectId);
  const existing = await prisma.dTAssessment.findFirst({
    where: {
      projectId: input.projectId,
      assetId: input.assetId,
      requirementId: input.requirementId,
      assessmentType: input.assessmentType,
    },
  });
  if (!existing?.attachmentStoredPath) return;
  const fullPath = path.join(process.cwd(), "uploads", existing.attachmentStoredPath);
  await fs.unlink(fullPath).catch(() => {});
  await prisma.dTAssessment.update({
    where: { id: existing.id },
    data: {
      attachmentFilename: null,
      attachmentStoredPath: null,
      attachmentMimeType: null,
      attachmentSize: null,
    },
  });
  revalidatePath(`/projects/${input.projectId}/assessment`);
}

// ── CSV asset bulk import ─────────────────────────────────────────
// Expected CSV columns (header row required):
//   kind,name,description,metadata
// metadata is an optional JSON object (will be JSON.stringified into DB)
// OR key=value pairs separated by `;` (e.g., "role=edge;vendor=abc")
export async function importAssetsFromCSV(input: {
  projectId: string;
  csvText: string;
}): Promise<{ created: number; errors: string[] }> {
  await assertProjectEditable(input.projectId);

  const { parseAssetCSV } = await import("@/lib/asset-csv");
  const { rows, errors } = parseAssetCSV(input.csvText);

  let created = 0;
  for (const row of rows) {
    try {
      await prisma.asset.create({
        data: {
          projectId: input.projectId,
          kind: row.kind,
          name: row.name,
          description: row.description || null,
          metadata: JSON.stringify(row.metadata),
        },
      });
      created++;
    } catch (err) {
      errors.push(`Row "${row.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  revalidatePath(`/projects/${input.projectId}/assets`);
  revalidatePath("/");
  return { created, errors };
}

// ── Share tokens ────────────────────────────────────────────────────────────

export async function createShareToken(projectId: string): Promise<string> {
  const session = await requireProjectAccess(projectId);
  const token = crypto.randomBytes(16).toString("hex"); // 32-char hex
  await prisma.shareToken.create({
    data: {
      projectId,
      token,
      createdBy: session.userId,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/share`);
  return token;
}

export async function revokeShareToken(input: {
  tokenId: string;
  projectId: string;
}): Promise<void> {
  await requireProjectAccess(input.projectId);
  await prisma.shareToken.deleteMany({
    where: { id: input.tokenId, projectId: input.projectId },
  });
  revalidatePath(`/projects/${input.projectId}/share`);
}

// ── Screening reset (unlock DT by clearing screening so user can re-enter) ──
export async function resetScreeningAndDependents(projectId: string) {
  await assertProjectEditable(projectId);
  await prisma.$transaction(async (tx) => {
    await tx.dTAnswer.deleteMany({ where: { projectId } });
    await tx.dTEvidence.deleteMany({ where: { projectId } });
    await tx.dTAssessment.deleteMany({ where: { projectId } });
    await tx.screeningAnswer.deleteMany({ where: { projectId } });
    await tx.project.update({
      where: { id: projectId },
      data: {
        applicable1: false,
        applicable2: false,
        applicable3: false,
        mechanismCandidates: "[]",
        screeningComplete: false,
      },
    });
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  redirect(`/projects/${projectId}/screening`);
}
