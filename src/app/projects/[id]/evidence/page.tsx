import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
  CircleDashed,
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
  evidencePromptFor,
  buildPathSummary,
  type DTOutcome,
  type EvidenceField,
} from "@/lib/decision-trees";
import { StructuredEvidenceForm } from "./structured-evidence-form";
import { EvidenceForm } from "./evidence-form";
import { LockedBanner } from "../locked-banner";
import { requireSession } from "@/lib/auth";
import { AIFillEvidenceButton } from "./ai-fill-evidence-button";

export default async function EvidencePage({
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
      dtAnswers: true,
      dtEvidences: { select: { id: true, assetId: true, requirementId: true, fieldId: true, value: true, userReviewed: true } },
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

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.includes(selectedStandard) &&
      evaluateRequirementApplicability(r, screeningAnswersMap).applies,
  );

  // Group evidences by (req, asset)
  const evidenceValueMap = new Map<string, string>();
  for (const ev of project.dtEvidences) {
    const key = `${ev.requirementId}::${ev.assetId ?? "__global__"}::${ev.fieldId}`;
    evidenceValueMap.set(key, ev.value);
  }

  type RequirementBlock = {
    reqId: string;
    reqTitle: string;
    reqMechanism: string;
    reqClause: string;
    usesStructured: boolean;
    iterations: Array<{
      assetId: string | null;
      assetKind: string | null;
      assetLabel: string | null;
      outcome: DTOutcome | "incomplete";
      pathSummary: string;
      // For structured: the answers map for visibility filtering
      answeredMap: Record<string, "yes" | "no">;
      // For structured: the subset of evidence fields that apply + current values
      applicableFields: Array<{ field: EvidenceField; value: string }>;
      // For legacy notes fallback: YES-answered path steps
      pathSteps: Array<{
        nodeId: string;
        nodeText_ko: string;
        answer: "yes" | "no";
        prompt_ko: string;
        prompt_en: string;
        notes: string;
        isTerminal: boolean;
      }>;
    }>;
  };

  const blocks: RequirementBlock[] = [];

  for (const req of visibleReqs) {
    const iters: Array<{
      assetId: string | null;
      assetKind: string | null;
      assetLabel: string | null;
    }> = [];
    if (req.iterateOver) {
      const dedupedKinds = getApplicableKindsFor(
        req,
        DT_REQUIREMENTS,
        applicableStandards,
      );
      const matching = matchAssetsForRequirement(req, parsedAssets, dedupedKinds);
      for (const a of matching) {
        iters.push({
          assetId: a.id,
          assetKind: a.kind,
          assetLabel: `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
        });
      }
    } else {
      iters.push({ assetId: null, assetKind: null, assetLabel: null });
    }

    const block: RequirementBlock = {
      reqId: req.id,
      reqTitle: req.title_ko,
      reqMechanism: req.mechanismCode,
      reqClause: req.clause,
      usesStructured: !!(req.evidenceFields && req.evidenceFields.length > 0),
      iterations: [],
    };

    for (const it of iters) {
      // Auto-NA via naFromRequirement: skip the form entirely.
      if (req.naFromRequirement) {
        const linked = project.dtAnswers
          .filter(
            (d) =>
              d.requirementId === req.naFromRequirement!.requirementId &&
              (d.assetId ?? null) === it.assetId,
          )
          .map((d) => ({
            nodeId: d.nodeId,
            answer: d.answer as "yes" | "no",
          }));
        if (evaluateNAFromRequirement(req, linked).applies) {
          continue;
        }
      }

      const answers: Record<string, "yes" | "no"> = {};
      const notesByNode: Record<string, string> = {};
      for (const ans of project.dtAnswers) {
        if (
          ans.requirementId === req.id &&
          (ans.assetId ?? null) === it.assetId
        ) {
          if (ans.answer === "yes" || ans.answer === "no") {
            answers[ans.nodeId] = ans.answer;
          }
          notesByNode[ans.nodeId] = ans.notes ?? "";
        }
      }

      if (Object.keys(answers).length === 0) continue;

      const walk = walkTree(req, answers);
      const outcome: DTOutcome | "incomplete" =
        walk.kind === "outcome" ? walk.outcome : "incomplete";
      const pathSummary = buildPathSummary(walk);

      // Structured: compute which fields apply given current answers + asset kind
      const applicableFields: Array<{ field: EvidenceField; value: string }> = [];
      if (block.usesStructured && req.evidenceFields) {
        for (const f of req.evidenceFields) {
          // Asset kind filter
          if (
            f.scope === "per_asset" &&
            f.appliesToKinds &&
            (it.assetKind === null ||
              !f.appliesToKinds.includes(it.assetKind as never))
          ) {
            continue;
          }
          // Dependent-answer filter
          if (f.dependsOnAnswer) {
            if (answers[f.dependsOnAnswer.nodeId] !== f.dependsOnAnswer.answer)
              continue;
          }
          const key = `${req.id}::${it.assetId ?? "__global__"}::${f.id}`;
          applicableFields.push({
            field: f,
            value: evidenceValueMap.get(key) ?? "",
          });
        }
      }

      // Legacy: YES-only path steps for requirements without structured fields
      const pathSteps = block.usesStructured
        ? []
        : walk.path
            .filter((step) => step.answer === "yes")
            .map((step, idx, arr) => {
              const node = req.nodes[step.nodeId];
              const prompt = evidencePromptFor(node, step.answer);
              const isTerminal =
                idx === arr.length - 1 && walk.kind === "outcome";
              return {
                nodeId: step.nodeId,
                nodeText_ko: node.text_ko,
                answer: step.answer,
                prompt_ko: prompt.ko,
                prompt_en: prompt.en,
                notes: notesByNode[step.nodeId] ?? "",
                isTerminal,
              };
            });

      block.iterations.push({
        assetId: it.assetId,
        assetKind: it.assetKind,
        assetLabel: it.assetLabel,
        outcome,
        pathSummary,
        answeredMap: answers,
        applicableFields,
        pathSteps,
      });
    }

    if (block.iterations.length > 0) blocks.push(block);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/projects/${project.id}/dt`}>
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            DT 평가 / Back
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          증빙 정보 입력
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Required Information
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          EN 18031 표준이 요구하는 각 요구사항별 Required Information(E.Info / E.Just)을 입력합니다.
          DT 답변에 따라 필요한 필드만 자동으로 표시됩니다.
        </p>
      </div>

      <LockedBanner
        projectId={project.id}
        finalizedAt={project.finalizedAt}
        finalizedBy={project.finalizedBy}
      />

      <div className="flex justify-end">
        <AIFillEvidenceButton
          projectId={project.id}
          hasAttachments={project.attachments.length > 0}
          hasReviewedFields={project.dtEvidences.some((e) => e.userReviewed)}
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
                href={`/projects/${project.id}/evidence?standard=${s}`}
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
            이 표준에서 아직 DT 답변이 기록된 요구사항이 없습니다.
            <br />
            먼저{" "}
            <Link
              href={`/projects/${project.id}/dt?standard=${selectedStandard}`}
              className="text-primary underline"
            >
              Decision Tree 평가
            </Link>
            를 진행해 주세요.
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
                            {block.usesStructured && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">
                                Required Info (EN 18031)
                              </Badge>
                            )}
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
                            <OutcomeBadge outcome={it.outcome} />
                          </div>
                          {block.usesStructured ? (
                            <StructuredEvidenceForm
                              projectId={project.id}
                              assetId={it.assetId}
                              requirementId={block.reqId}
                              fields={it.applicableFields}
                              pathSummary={it.pathSummary}
                              readOnly={project.finalizedAt !== null}
                            />
                          ) : (
                            <EvidenceForm
                              projectId={project.id}
                              assetId={it.assetId}
                              mechanismCode={block.reqMechanism}
                              requirementId={block.reqId}
                              steps={it.pathSteps}
                              readOnly={project.finalizedAt !== null}
                            />
                          )}
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
        <Link href={`/projects/${project.id}/dt`}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            DT 평가로 / Back
          </Button>
        </Link>
        {isConsultant ? (
          <Link href={`/projects/${project.id}/assessment`}>
            <Button>
              기능 평가 / Technical Assessment
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        ) : (
          <Link href={`/projects/${project.id}/report`}>
            <Button>
              최종 리포트 / Final Report
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: DTOutcome | "incomplete" }) {
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
  if (outcome === "not_applicable")
    return (
      <Badge variant="secondary">
        <MinusCircle className="mr-1 size-3" />
        N/A
      </Badge>
    );
  return (
    <Badge variant="outline">
      <CircleDashed className="mr-1 size-3" />
      진행중 / In progress
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
