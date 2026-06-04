import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
} from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MECHANISMS, STANDARDS, type StandardId } from "@/lib/mechanisms";
import { LockedBanner } from "../locked-banner";
import { AIFillDTAllButton } from "./ai-fill-dt-all-button";
import { DTScrollRestorer } from "./dt-scroll-restorer";
import {
  DT_REQUIREMENTS,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  getApplicableKindsFor,
  matchAssetsForRequirement,
  walkTree,
  requirementById,
  type NodeAnswer,
} from "@/lib/decision-trees";
import {
  DTOverviewClient,
  type SerializedMechGroup,
  type SerializedReqRow,
} from "./dt-overview-client";

export default async function DTOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ standard?: string }>;
}) {
  const { id } = await params;
  const { standard: standardParam } = await searchParams;
  const session = await requireSession();
  const isConsultant = session.role === "consultant";

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      assets: true,
      dtAnswers: { select: { id: true, assetId: true, requirementId: true, nodeId: true, answer: true, notes: true, userReviewed: true, aiGenerated: true } },
      screeningAnswers: true,
      attachments: { select: { id: true } },
    },
  });
  if (!project) notFound();

  // Map screening answers for gating requirement applicability.
  const screeningAnswersMap: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswersMap[a.questionId] = a.answer;
    }
  }

  if (!project.screeningComplete) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center">
            <CircleAlert className="mx-auto size-8 text-amber-500" />
            <p className="mt-3 text-sm font-medium">
              스크리닝이 아직 완료되지 않았습니다. / Screening is not complete.
            </p>
            <Link href={`/projects/${project.id}/screening`}>
              <Button className="mt-4">스크리닝 진행 / Go to Screening</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const candidates: string[] = JSON.parse(project.mechanismCandidates);
  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);

  if (applicableStandards.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center">
            <CircleAlert className="mx-auto size-8 text-amber-500" />
            <p className="mt-3 text-sm font-medium">
              적용 대상 EN 18031 표준이 없습니다. / No applicable EN 18031 standard.
            </p>
            <Link href={`/projects/${project.id}/result`}>
              <Button variant="outline" className="mt-4">
                스크리닝 결과 보기 / View Screening Result
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine selected standard from query param (fallback to first applicable)
  const parsed = standardParam ? Number(standardParam) : NaN;
  const selectedStandard: StandardId =
    parsed === 1 || parsed === 2 || parsed === 3
      ? applicableStandards.includes(parsed as StandardId)
        ? (parsed as StandardId)
        : applicableStandards[0]
      : applicableStandards[0];

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    metadata: safeJson(a.metadata),
  }));

  // All requirements that match candidates + one of the applicable standards.
  const allApplicable = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.some((s) => applicableStandards.includes(s)),
  );

  // Compute per-standard requirement counts for tab labels
  const tabCounts = new Map<StandardId, number>();
  for (const s of applicableStandards) {
    tabCounts.set(
      s,
      allApplicable.filter((r) => r.standards.includes(s)).length,
    );
  }

  // Requirements visible in the currently selected tab
  const visibleReqs = allApplicable.filter((r) =>
    r.standards.includes(selectedStandard),
  );

  // Group visible requirements by mechanism
  const byMechanism = new Map<string, typeof visibleReqs>();
  for (const r of visibleReqs) {
    const arr = byMechanism.get(r.mechanismCode) ?? [];
    arr.push(r);
    byMechanism.set(r.mechanismCode, arr);
  }

  // Mechanisms from screening candidates that have no DT for the selected standard
  const mechanismsWithoutDTs = candidates.filter((code) => {
    const mech = MECHANISMS.find((m) => m.code === code);
    if (!mech) return false;
    if (!mech.standards.includes(selectedStandard)) return false;
    const hasDT = DT_REQUIREMENTS.some(
      (r) =>
        r.mechanismCode === code && r.standards.includes(selectedStandard),
    );
    return !hasDT;
  });

  // Per-requirement status (only for visible reqs)
  const reqStatuses = visibleReqs.map((req) => {
    // Screening gate: if not applicable per screening, mark as N/A outright.
    const applicability = evaluateRequirementApplicability(
      req,
      screeningAnswersMap,
    );
    if (!applicability.applies) {
      return {
        req,
        totals: { total: 0, pass: 0, fail: 0, na: 1, pending: 0 },
        isGlobal: !req.iterateOver,
        naFromScreening: true as const,
        failedCondition: applicability.failedCondition,
      };
    }
    if (req.iterateOver) {
      const dedupedKinds = getApplicableKindsFor(
        req,
        DT_REQUIREMENTS,
        applicableStandards,
      );
      const assets = matchAssetsForRequirement(req, parsedAssets, dedupedKinds);
      const perAsset = assets.map((a) => {
        // Auto-NA from linked requirement (e.g., ACM-2 ← ACM-1 DN-1/2/3 YES)
        if (req.naFromRequirement) {
          const linked = project.dtAnswers
            .filter(
              (d) =>
                d.requirementId === req.naFromRequirement!.requirementId &&
                d.assetId === a.id,
            )
            .map((d) => ({
              nodeId: d.nodeId,
              answer: d.answer as NodeAnswer,
            }));
          const gate = evaluateNAFromRequirement(
            req,
            linked,
            requirementById(req.naFromRequirement!.requirementId),
          );
          if (gate.applies) {
            return {
              asset: a,
              walk: {
                kind: "outcome" as const,
                outcome: "not_applicable" as const,
                path: [],
              },
            };
          }
        }
        const answers = answersForAssetReq(project.dtAnswers, a.id, req.id);
        const walk = walkTree(req, answers);
        return { asset: a, walk };
      });
      const totals = {
        total: perAsset.length,
        pass: perAsset.filter(
          (p) => p.walk.kind === "outcome" && p.walk.outcome === "pass",
        ).length,
        fail: perAsset.filter(
          (p) => p.walk.kind === "outcome" && p.walk.outcome === "fail",
        ).length,
        na: perAsset.filter(
          (p) =>
            p.walk.kind === "outcome" && p.walk.outcome === "not_applicable",
        ).length,
        pending: perAsset.filter((p) => p.walk.kind === "question").length,
      };
      return { req, totals, isGlobal: false };
    } else {
      // Global (non-iterating) requirement — also supports naFromRequirement
      if (req.naFromRequirement) {
        const linked = project.dtAnswers
          .filter(
            (d) =>
              d.requirementId === req.naFromRequirement!.requirementId &&
              d.assetId === null,
          )
          .map((d) => ({
            nodeId: d.nodeId,
            answer: d.answer as NodeAnswer,
          }));
        const gate = evaluateNAFromRequirement(
          req,
          linked,
          requirementById(req.naFromRequirement!.requirementId),
        );
        if (gate.applies) {
          return {
            req,
            totals: { total: 1, pass: 0, fail: 0, na: 1, pending: 0 },
            isGlobal: true,
          };
        }
      }
      const answers = answersForAssetReq(project.dtAnswers, null, req.id);
      const walk = walkTree(req, answers);
      return {
        req,
        totals: {
          total: 1,
          pass: walk.kind === "outcome" && walk.outcome === "pass" ? 1 : 0,
          fail: walk.kind === "outcome" && walk.outcome === "fail" ? 1 : 0,
          na:
            walk.kind === "outcome" && walk.outcome === "not_applicable"
              ? 1
              : 0,
          pending: walk.kind === "question" ? 1 : 0,
        },
        isGlobal: true,
      };
    }
  });

  // Screening-gated N/A and empty-iteration N/A both count as a single resolved
  // N/A — the requirement is fully resolved as Not Applicable to this product.
  const totalExpected = reqStatuses.reduce(
    (s, r) => s + Math.max(1, r.totals.total),
    0,
  );
  const totalDone = reqStatuses.reduce((s, r) => {
    if ("naFromScreening" in r && r.naFromScreening) return s + 1;
    if (r.req.iterateOver && r.totals.total === 0) return s + 1;
    return s + r.totals.pass + r.totals.fail + r.totals.na;
  }, 0);
  const pct = totalExpected === 0 ? 0 : Math.round((totalDone / totalExpected) * 100);

  const reviewedDTCount = project.dtAnswers.some((a) => a.userReviewed);

  const aiGeneratedReqIds = [
    ...new Set(
      project.dtAnswers
        .filter((a) => a.aiGenerated && !a.userReviewed)
        .map((a) => a.requirementId),
    ),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DTScrollRestorer projectId={project.id} />
      <div>
        <Link href={`/projects/${project.id}/assets/review`}>
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            자산 검토 / Assets Review
          </Button>
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Decision Tree 평가
              <span className="ml-2 text-base font-medium text-muted-foreground">
                / Decision Tree Evaluation
              </span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              제품: <span className="font-medium text-foreground">{project.name}</span>
              {" · "}
              {project.manufacturer}
            </p>
          </div>
          {isConsultant && (
            <AIFillDTAllButton
              projectId={project.id}
              hasAttachments={project.attachments.length > 0}
              hasReviewedAnswers={reviewedDTCount}
              disabled={project.finalizedAt !== null}
            />
          )}
        </div>
      </div>

      <LockedBanner
        projectId={project.id}
        finalizedAt={project.finalizedAt}
        finalizedBy={project.finalizedBy}
      />

      {/* Standard tabs — shown only when 2+ standards apply */}
      {applicableStandards.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b">
          {applicableStandards.map((s) => {
            const active = s === selectedStandard;
            const count = tabCounts.get(s) ?? 0;
            return (
              <Link
                key={s}
                href={`/projects/${project.id}/dt?standard=${s}`}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition -mb-px",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                )}
              >
                <span>EN 18031-{s}</span>
                <Badge
                  variant={active ? "default" : "outline"}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {count}
                </Badge>
              </Link>
            );
          })}
        </div>
      )}

      {/* Active standard header */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold">
          {STANDARDS[selectedStandard].name_ko}
        </h2>
        <span className="text-xs text-muted-foreground">
          {STANDARDS[selectedStandard].name_en}
          {" · "}
          {STANDARDS[selectedStandard].article}
        </span>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm">
            <span>
              <span className="font-medium">EN 18031-{selectedStandard}</span>{" "}
              진행률 / Progress:{" "}
              <span className="font-semibold text-foreground">
                {totalDone} / {totalExpected}
              </span>
            </span>
            <span className="font-semibold">{pct}%</span>
          </div>
          <Progress value={pct} className="mt-2" />
          <p className="mt-2 text-xs text-muted-foreground">
            선택한 표준의 요구사항(DT)별로 평가합니다. 각 요구사항은 자산별 또는 기기 전체 단위로 진행됩니다.
          </p>
        </CardContent>
      </Card>

      {/* Requirements grouped by mechanism — client component handles filter + collapse */}
      {byMechanism.size === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            이 표준에 해당하는 요구사항이 없습니다.
            <br />
            No applicable requirements for this standard.
          </CardContent>
        </Card>
      ) : (
        <DTOverviewClient
          groups={Array.from(byMechanism.entries()).map(([code, reqs]) => ({
            code,
            reqs: reqs.map((req) => {
              const status = reqStatuses.find((s) => s.req.id === req.id)!;
              return {
                id: req.id,
                title_ko: req.title_ko,
                title_en: req.title_en,
                iterateDescription_ko: req.iterateOver?.description_ko ?? undefined,
                isGlobal: !req.iterateOver,
                totals: status.totals,
                naFromScreening: "naFromScreening" in status && !!status.naFromScreening,
                failedConditionReason_ko:
                  "failedCondition" in status
                    ? ((status as { failedCondition?: { reason_ko?: string } }).failedCondition?.reason_ko ?? undefined)
                    : undefined,
              } satisfies SerializedReqRow;
            }),
          }))}
          projectId={project.id}
          selectedStandard={selectedStandard}
          mechanismsWithoutDTs={mechanismsWithoutDTs}
          aiGeneratedReqIds={isConsultant ? aiGeneratedReqIds : []}
        />
      )}

      <div className="flex items-center justify-between gap-4 py-4">
        <Link href={`/projects/${project.id}/assets/review`}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            자산 검토로 / Back
          </Button>
        </Link>
        <Link href={`/projects/${project.id}/evidence?standard=${selectedStandard}`}>
          <Button>
            증빙 정보 입력 / Next: Evidence
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

type AnswerRow = {
  assetId: string | null;
  requirementId: string;
  nodeId: string;
  answer: string;
};

function answersForAssetReq(
  rows: AnswerRow[],
  assetId: string | null,
  requirementId: string,
): Record<string, NodeAnswer> {
  const out: Record<string, NodeAnswer> = {};
  for (const r of rows) {
    if (r.requirementId !== requirementId) continue;
    if ((r.assetId ?? null) !== assetId) continue;
    if (r.answer === "yes" || r.answer === "no" || r.answer === "na")
      out[r.nodeId] = r.answer;
  }
  return out;
}

function safeJson(s: string): Record<string, string> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}
