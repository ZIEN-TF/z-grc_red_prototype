import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MECHANISMS } from "@/lib/mechanisms";
import { kindConfig } from "@/lib/asset-kinds";
import {
  requirementById,
  matchAssetsForRequirement,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  getApplicableKindsFor,
  walkTree,
  DT_REQUIREMENTS,
} from "@/lib/decision-trees";
import type { StandardId } from "@/lib/mechanisms";
import { MinusCircle } from "lucide-react";
import { RequirementEvaluator } from "./requirement-evaluator";
import { AcmInstancePanel } from "./acm-instance-panel";
import { SumInstancePanel } from "./sum-instance-panel";

export default async function RequirementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; reqId: string }>;
  searchParams: Promise<{ standard?: string }>;
}) {
  const { id, reqId } = await params;
  const { standard: standardParam } = await searchParams;
  const req = requirementById(reqId);
  if (!req) notFound();

  // Choose a standard for the back link: prefer ?standard= if it's one the
  // requirement belongs to, otherwise first standard the requirement applies to.
  const paramN = standardParam ? Number(standardParam) : NaN;
  const backStandard =
    (paramN === 1 || paramN === 2 || paramN === 3) &&
    req.standards.includes(paramN)
      ? paramN
      : req.standards[0];
  const backHref = `/projects/${id}/dt?standard=${backStandard}`;
  const mech = MECHANISMS.find((m) => m.code === req.mechanismCode);

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      assets: { orderBy: { createdAt: "asc" } },
      dtAnswers: { where: { requirementId: req.id } },
      screeningAnswers: true,
    },
  });
  if (!project) notFound();

  const screeningAnswersMap: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswersMap[a.questionId] = a.answer;
    }
  }
  const applicability = evaluateRequirementApplicability(req, screeningAnswersMap);

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    description: a.description,
    metadata: safeJson(a.metadata),
  }));

  // Determine applicable standards so we can dedupe asset kinds that were
  // already answered under an earlier applicable standard's equivalent
  // requirement (via `sameAs`).
  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);

  const dedupedKinds = getApplicableKindsFor(req, DT_REQUIREMENTS, applicableStandards);
  const coveredByEarlier = req.iterateOver
    ? req.iterateOver.kinds.filter((k) => !dedupedKinds.includes(k))
    : [];

  const matchingAssets = req.iterateOver
    ? matchAssetsForRequirement(req, parsedAssets, dedupedKinds).map((a) => ({
        id: a.id,
        name: a.name,
        kindLabel: kindConfig(a.kind)?.title_ko ?? a.kind,
      }))
    : [];

  // Serialize answers for the client
  const initialAnswers = project.dtAnswers.map((a) => ({
    assetId: a.assetId,
    nodeId: a.nodeId,
    answer: a.answer as "yes" | "no",
    notes: a.notes ?? "",
  }));

  // If this requirement has `naFromRequirement`, load the linked requirement's
  // answers for the SAME project so each asset iteration can auto-NA.
  const linkedAnswersByAsset: Record<string, { nodeId: string; answer: "yes" | "no" }[]> = {};
  let naGateMessage: { reason_ko?: string; reason_en?: string; linkedReqId: string } | null = null;
  if (req.naFromRequirement) {
    const linkedReqId = req.naFromRequirement.requirementId;
    const linked = await prisma.dTAnswer.findMany({
      where: { projectId: id, requirementId: linkedReqId },
    });
    for (const a of linked) {
      const k = a.assetId ?? "__global__";
      if (!linkedAnswersByAsset[k]) linkedAnswersByAsset[k] = [];
      linkedAnswersByAsset[k].push({
        nodeId: a.nodeId,
        answer: a.answer as "yes" | "no",
      });
    }
    naGateMessage = {
      reason_ko: req.naFromRequirement.reason_ko,
      reason_en: req.naFromRequirement.reason_en,
      linkedReqId,
    };
  }

  // Per-asset auto-NA evaluation used to pass into the client evaluator.
  const autoNAByAsset: Record<string, boolean> = {};
  if (req.naFromRequirement) {
    for (const a of matchingAssets) {
      const linked = linkedAnswersByAsset[a.id] ?? [];
      const res = evaluateNAFromRequirement(req, linked);
      if (res.applies) autoNAByAsset[a.id] = true;
    }
    if (!req.iterateOver) {
      const linked = linkedAnswersByAsset["__global__"] ?? [];
      const res = evaluateNAFromRequirement(req, linked);
      if (res.applies) autoNAByAsset["__global__"] = true;
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex flex-wrap items-baseline gap-2 text-2xl font-bold tracking-tight">
          <span className="rounded bg-primary/10 px-2 py-1 font-mono text-base text-primary">
            {req.id}
          </span>
          <span>{req.title_ko}</span>
          <span className="text-base font-medium text-muted-foreground">
            / {req.title_en}
          </span>
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="mr-1 font-medium text-foreground">조항:</span>
            {req.clause}
          </span>
          {mech && (
            <span>
              <span className="mr-1 font-medium text-foreground">메커니즘:</span>
              {mech.code} · {mech.name_ko}
            </span>
          )}
          <span>
            <span className="mr-1 font-medium text-foreground">제품:</span>
            {project.name} · {project.manufacturer}
          </span>
        </p>
      </div>

      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            요구사항 원문 / Requirement
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {req.clause}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="whitespace-pre-line leading-relaxed">
            {req.requirementText_ko}
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              원문 보기 / Show English ▼
            </summary>
            <div className="mt-2 whitespace-pre-line rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {req.requirementText_en}
            </div>
          </details>
        </CardContent>
      </Card>

      <Card className="border-accent bg-accent/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            평가 단위 / Evaluation Scope
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {req.iterateOver ? (
            <>
              <p className="font-medium">{req.iterateOver.description_ko}</p>
              <p className="mt-0.5 text-xs italic text-muted-foreground">
                {req.iterateOver.description_en}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  해당 자산 {matchingAssets.length}개 / {matchingAssets.length} matching asset(s)
                </Badge>
                {coveredByEarlier.length > 0 && (
                  <Badge variant="outline" className="text-[11px]">
                    {coveredByEarlier
                      .map((k) => kindConfig(k)?.title_ko ?? k)
                      .join(", ")}
                    는 상위 표준에서 이미 평가됨
                  </Badge>
                )}
              </div>
            </>
          ) : (
            <p>기기 전체 단위로 1회 평가 / Evaluated once for the whole device</p>
          )}
        </CardContent>
      </Card>

      {!applicability.applies ? (
        <Card className="border-muted-foreground/30 bg-muted/30">
          <CardContent className="flex items-start gap-3 py-6 text-sm">
            <MinusCircle className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-base font-semibold">
                NOT APPLICABLE — 이 요구사항은 해당되지 않습니다
              </p>
              <p className="mt-1 text-muted-foreground">
                {applicability.failedCondition.reason_ko ??
                  `스크리닝 질문 ${applicability.failedCondition.questionId}의 답변 기준으로 해당되지 않습니다.`}
              </p>
              {applicability.failedCondition.reason_en && (
                <p className="mt-0.5 text-xs italic text-muted-foreground">
                  {applicability.failedCondition.reason_en}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                스크리닝 답변을 변경하고 싶으시면 아래 링크를 이용하세요.
              </p>
              <Link
                href={`/projects/${project.id}/screening`}
                className="mt-1 inline-block text-xs text-primary underline"
              >
                스크리닝 수정 / Edit Screening
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <RequirementEvaluator
            projectId={project.id}
            requirement={req}
            matchingAssets={matchingAssets}
            initialAnswers={initialAnswers}
            sameAsRef={
              req.sameAs ? await buildSameAsRef(req.sameAs, project.id) : null
            }
            autoNAByAsset={autoNAByAsset}
            naGateMessage={naGateMessage}
          />
          {isAcm2RequirementId(req.id) && (
            <AcmInstancePanel
              projectId={project.id}
              readOnly={project.finalizedAt !== null}
              initial={await loadAcmInstances(project.id)}
            />
          )}
          {isSum1RequirementId(req.id) && isSum1Pass(req, project.dtAnswers) && (
            <SumInstancePanel
              projectId={project.id}
              readOnly={project.finalizedAt !== null}
              initial={await loadSumInstances(project.id)}
            />
          )}
        </>
      )}

      <div className="pt-2">
        <Link href={backHref}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            요구사항 목록으로 / Back to DT List
          </Button>
        </Link>
      </div>
    </div>
  );
}

function isAcm2RequirementId(id: string): boolean {
  return id === "P1.ACM-2" || id === "P2.ACM-2" || id === "P3.ACM-2";
}

function isSum1RequirementId(id: string): boolean {
  return id === "P1.SUM-1" || id === "P2.SUM-1" || id === "P3.SUM-1";
}

function isSum1Pass(
  req: { nodes: Record<string, unknown>; rootNodeId: string } & Parameters<
    typeof walkTree
  >[0],
  dtAnswers: Array<{
    requirementId: string;
    assetId: string | null;
    nodeId: string;
    answer: string;
  }>,
): boolean {
  const answers: Record<string, "yes" | "no"> = {};
  for (const d of dtAnswers) {
    if (d.requirementId === req.id && d.assetId === null) {
      if (d.answer === "yes" || d.answer === "no") {
        answers[d.nodeId] = d.answer;
      }
    }
  }
  if (Object.keys(answers).length === 0) return false;
  const walk = walkTree(req, answers);
  return walk.kind === "outcome" && walk.outcome === "pass";
}

async function loadSumInstances(projectId: string) {
  const rows = await prisma.asset.findMany({
    where: { projectId, kind: "sum_instance" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

async function loadAcmInstances(projectId: string) {
  const rows = await prisma.asset.findMany({
    where: { projectId, kind: "acm_instance" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, metadata: true },
  });
  return rows.map((r) => {
    let meta: Record<string, string> = {};
    try {
      const parsed = JSON.parse(r.metadata);
      if (parsed && typeof parsed === "object") {
        meta = parsed as Record<string, string>;
      }
    } catch {}
    const pt = meta.password_type;
    const passwordType:
      | "factory_default"
      | "user_set"
      | "third_party"
      | "none"
      | "" =
      pt === "factory_default" ||
      pt === "user_set" ||
      pt === "third_party" ||
      pt === "none"
        ? pt
        : "";
    return {
      id: r.id,
      name: r.name,
      interfaceNetwork: meta.interface_network === "yes",
      interfaceUser: meta.interface_user === "yes",
      interfaceMachine: meta.interface_machine === "yes",
      passwordType,
    };
  });
}

async function buildSameAsRef(sameAsId: string, projectId: string) {
  const { requirementById } = await import("@/lib/decision-trees");
  const src = requirementById(sameAsId);
  if (!src) return null;
  const count = await prisma.dTAnswer.count({
    where: { projectId, requirementId: sameAsId },
  });
  return {
    id: src.id,
    title_ko: src.title_ko,
    title_en: src.title_en,
    hasAnswers: count > 0,
    answerCount: count,
  };
}

function safeJson(s: string): Record<string, string> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object")
      return parsed as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}
