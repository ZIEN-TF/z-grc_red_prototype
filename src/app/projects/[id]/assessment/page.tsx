import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  CircleAlert,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { MECHANISMS, STANDARDS, type StandardId } from "@/lib/mechanisms";
import { kindConfig } from "@/lib/asset-kinds";
import {
  DT_REQUIREMENTS,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  getApplicableKindsFor,
  matchAssetsForRequirement,
  walkTree,
  assessmentsFor,
  type DTOutcome,
  type AssessmentType,
} from "@/lib/decision-trees";
import { AssessmentForm } from "./assessment-form";
import { LockedBanner } from "../locked-banner";
import { AIFillAssessmentButton } from "./ai-fill-assessment-button";

type IterationBlock = {
  assetId: string | null;
  assetLabel: string | null; // null → global
  outcome: DTOutcome;
  assessments: Array<{
    type: AssessmentType;
    testMethod: string;
    testResult: string;
    verdict: "pass" | "fail" | "not_applicable" | null;
    attachment: {
      filename: string;
      mimeType: string;
      size: number;
    } | null;
  }>;
};

type RequirementBlock = {
  reqId: string;
  reqTitle: string;
  reqMechanism: string;
  reqClause: string;
  iterations: IterationBlock[];
};

export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ standard?: string }>;
}) {
  const { id } = await params;
  const { standard: standardParam } = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      assets: true,
      dtAnswers: true,
      dtAssessments: true,
      screeningAnswers: true,
      attachments: { select: { id: true } },
    },
  });
  if (!project) notFound();

  if (!project.screeningComplete) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center">
            <CircleAlert className="mx-auto size-8 text-amber-500" />
            <p className="mt-3 text-sm font-medium">
              스크리닝이 아직 완료되지 않았습니다.
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

  const parsed = standardParam ? Number(standardParam) : NaN;
  const selectedStandard: StandardId =
    parsed === 1 || parsed === 2 || parsed === 3
      ? applicableStandards.includes(parsed as StandardId)
        ? (parsed as StandardId)
        : applicableStandards[0]
      : applicableStandards[0];

  const screeningAnswersMap: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      screeningAnswersMap[a.questionId] = a.answer;
    }
  }

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    metadata: safeJson(a.metadata),
  }));

  // Assessments keyed by (requirementId :: assetKey :: assessmentType)
  const assessmentMap = new Map<
    string,
    {
      testMethod: string;
      testResult: string;
      verdict: "pass" | "fail" | "not_applicable" | null;
      attachment: { filename: string; mimeType: string; size: number } | null;
    }
  >();
  for (const a of project.dtAssessments) {
    const key = `${a.requirementId}::${a.assetId ?? "__global__"}::${a.assessmentType}`;
    assessmentMap.set(key, {
      testMethod: a.testMethod,
      testResult: a.testResult,
      verdict:
        a.verdict === "pass" || a.verdict === "fail" || a.verdict === "not_applicable"
          ? a.verdict
          : null,
      attachment: a.attachmentFilename
        ? {
            filename: a.attachmentFilename,
            mimeType: a.attachmentMimeType ?? "",
            size: a.attachmentSize ?? 0,
          }
        : null,
    });
  }

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.includes(selectedStandard) &&
      evaluateRequirementApplicability(r, screeningAnswersMap).applies &&
      assessmentsFor(r.id).length > 0,
  );

  const blocks: RequirementBlock[] = [];

  for (const req of visibleReqs) {
    const assessTypes = assessmentsFor(req.id);
    const iterations: IterationBlock[] = [];

    const pushIter = (
      assetId: string | null,
      assetLabel: string | null,
      outcome: DTOutcome,
    ) => {
      iterations.push({
        assetId,
        assetLabel,
        outcome,
        assessments: assessTypes.map((t) => {
          const key = `${req.id}::${assetId ?? "__global__"}::${t}`;
          const rec = assessmentMap.get(key);
          return {
            type: t,
            testMethod: rec?.testMethod ?? "",
            testResult: rec?.testResult ?? "",
            verdict: rec?.verdict ?? null,
            attachment: rec?.attachment ?? null,
          };
        }),
      });
    };

    if (req.iterateOver) {
      const dedupedKinds = getApplicableKindsFor(
        req,
        DT_REQUIREMENTS,
        applicableStandards,
      );
      const matching = matchAssetsForRequirement(req, parsedAssets, dedupedKinds);
      for (const a of matching) {
        // Auto-NA via naFromRequirement
        if (req.naFromRequirement) {
          const linked = project.dtAnswers
            .filter(
              (d) =>
                d.requirementId === req.naFromRequirement!.requirementId &&
                d.assetId === a.id,
            )
            .map((d) => ({
              nodeId: d.nodeId,
              answer: d.answer as "yes" | "no",
            }));
          if (evaluateNAFromRequirement(req, linked).applies) {
            continue; // skip assessment for auto-NA assets
          }
        }
        // Look up own DT outcome
        const answers: Record<string, "yes" | "no"> = {};
        for (const d of project.dtAnswers) {
          if (d.requirementId === req.id && d.assetId === a.id) {
            answers[d.nodeId] = d.answer as "yes" | "no";
          }
        }
        if (Object.keys(answers).length === 0) continue;
        const walk = walkTree(req, answers);
        if (walk.kind !== "outcome") continue;
        if (walk.outcome === "not_applicable") continue; // skip NA iterations
        pushIter(
          a.id,
          `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
          walk.outcome,
        );
      }
    } else {
      // Global requirement
      if (req.naFromRequirement) {
        const linked = project.dtAnswers
          .filter(
            (d) =>
              d.requirementId === req.naFromRequirement!.requirementId &&
              d.assetId === null,
          )
          .map((d) => ({
            nodeId: d.nodeId,
            answer: d.answer as "yes" | "no",
          }));
        if (evaluateNAFromRequirement(req, linked).applies) continue;
      }
      const answers: Record<string, "yes" | "no"> = {};
      for (const d of project.dtAnswers) {
        if (d.requirementId === req.id && d.assetId === null) {
          answers[d.nodeId] = d.answer as "yes" | "no";
        }
      }
      if (Object.keys(answers).length === 0) continue;
      const walk = walkTree(req, answers);
      if (walk.kind !== "outcome") continue;
      if (walk.outcome === "not_applicable") continue;
      pushIter(null, null, walk.outcome);
    }

    if (iterations.length > 0) {
      blocks.push({
        reqId: req.id,
        reqTitle: req.title_ko,
        reqMechanism: req.mechanismCode,
        reqClause: req.clause,
        iterations,
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/projects/${project.id}/evidence?standard=${selectedStandard}`}>
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            증빙 입력 / Back
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          기능 평가
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Technical Assessment
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          인증 컨설턴트가 각 요구사항에 대해 기능 완전성·충분성 평가를 수행하고
          테스트 방법·결과를 기록합니다. DT 결과가 PASS 또는 FAIL인 항목만 표시되며,
          NOT APPLICABLE 항목은 제외됩니다.
        </p>
      </div>

      <LockedBanner
        projectId={project.id}
        finalizedAt={project.finalizedAt}
        finalizedBy={project.finalizedBy}
      />

      <div className="flex justify-end">
        <AIFillAssessmentButton
          projectId={project.id}
          hasAttachments={project.attachments.length > 0}
          hasReviewedFields={project.dtAssessments.some((a) => a.userReviewed)}
          disabled={project.finalizedAt !== null}
        />
      </div>

      {applicableStandards.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b">
          {applicableStandards.map((s) => {
            const active = s === selectedStandard;
            return (
              <Link
                key={s}
                href={`/projects/${project.id}/assessment?standard=${s}`}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition -mb-px",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                )}
              >
                EN 18031-{s}
              </Link>
            );
          })}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        현재 표준:{" "}
        <span className="font-medium text-foreground">
          {STANDARDS[selectedStandard].name_ko}
        </span>
      </p>

      {blocks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            이 표준에서 아직 평가 대상 항목이 없습니다.
            <br />
            먼저{" "}
            <Link
              href={`/projects/${project.id}/dt?standard=${selectedStandard}`}
              className="text-primary underline"
            >
              Decision Tree 평가
            </Link>
            를 PASS/FAIL로 확정한 후 다시 방문해 주세요.
          </CardContent>
        </Card>
      ) : (
        groupByMechanism(blocks).map(({ code, blocks: groupBlocks }) => {
          const mech = MECHANISMS.find((m) => m.code === code);
          return (
            <details
              key={code}
              className="group rounded-lg border bg-card"
              open
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-2">
                  <span className="inline-block size-1.5 shrink-0 rotate-0 rounded-sm border-b-2 border-r-2 border-foreground transition-transform group-open:rotate-45" />
                  <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                    {code}
                  </span>
                  <span className="font-medium">{mech?.name_ko ?? code}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {groupBlocks.length}개 요구사항
                  </Badge>
                </div>
              </summary>
              <div className="space-y-4 border-t p-4">
                {groupBlocks.map((block) => (
                  <Card key={block.reqId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                            <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                              {block.reqId}
                            </span>
                            <span className="truncate">{block.reqTitle}</span>
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {block.reqClause}
                          </CardDescription>
                        </div>
                        <Link
                          href={`/projects/${project.id}/dt/${block.reqId}?standard=${selectedStandard}`}
                          className="shrink-0 text-xs text-primary underline"
                        >
                          DT 평가로 이동
                        </Link>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {block.iterations.map((it) => (
                        <div
                          key={`${block.reqId}-${it.assetId ?? "global"}`}
                          className="rounded-lg border p-4"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm">
                              {it.assetLabel ? (
                                <>
                                  <span className="font-medium">
                                    {it.assetLabel.split(" · ")[0]}
                                  </span>
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {it.assetLabel.split(" · ").slice(1).join(" · ")}
                                  </span>
                                </>
                              ) : (
                                <span className="font-medium">기기 전체</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">
                                DT 결과
                              </span>
                              <OutcomeBadge outcome={it.outcome} />
                            </div>
                          </div>
                          <AssessmentForm
                            projectId={project.id}
                            assetId={it.assetId}
                            requirementId={block.reqId}
                            assessments={it.assessments}
                            readOnly={project.finalizedAt !== null}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </details>
          );
        })
      )}

      <div className="flex items-center justify-between gap-4 py-4">
        <Link href={`/projects/${project.id}/evidence?standard=${selectedStandard}`}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            증빙 입력 / Back
          </Button>
        </Link>
        <Link href={`/projects/${project.id}/report`}>
          <Button>
            최종 리포트 / Final Report
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: DTOutcome }) {
  if (outcome === "pass")
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 size-3" />
        PASS
      </Badge>
    );
  if (outcome === "fail")
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 size-3" />
        FAIL
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <MinusCircle className="mr-1 size-3" />
      N/A
    </Badge>
  );
}

// Group requirement blocks by their mechanismCode, preserving the order in
// which each mechanism first appears.
function groupByMechanism<B extends { reqMechanism: string }>(
  blocks: B[],
): Array<{ code: string; blocks: B[] }> {
  const order: string[] = [];
  const byCode = new Map<string, B[]>();
  for (const b of blocks) {
    if (!byCode.has(b.reqMechanism)) {
      order.push(b.reqMechanism);
      byCode.set(b.reqMechanism, []);
    }
    byCode.get(b.reqMechanism)!.push(b);
  }
  return order.map((code) => ({ code, blocks: byCode.get(code)! }));
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
