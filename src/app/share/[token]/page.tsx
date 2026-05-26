import { notFound } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  CircleDashed,
  Lock,
  Eye,
  Package,
  GitBranch,
  FileText,
  Microscope,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MECHANISMS, STANDARDS, type StandardId } from "@/lib/mechanisms";
import {
  DT_REQUIREMENTS,
  requirementById,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  getApplicableKindsFor,
  matchAssetsForRequirement,
  walkTree,
  type NodeAnswer,
} from "@/lib/decision-trees";

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const shareToken = await prisma.shareToken.findUnique({
    where: { token },
    include: {
      project: {
        include: {
          assets: true,
          dtAnswers: true,
          screeningAnswers: true,
          _count: {
            select: {
              assets: true,
              dtAnswers: true,
              dtEvidences: true,
              dtAssessments: true,
              attachments: true,
            },
          },
        },
      },
    },
  });

  if (!shareToken) notFound();

  if (shareToken.expiresAt && shareToken.expiresAt < new Date()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-sm text-center">
          <CardContent className="py-10">
            <Lock className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">이 공유 링크는 만료되었습니다.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This share link has expired.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const project = shareToken.project;

  const standards: StandardId[] = [];
  if (project.applicable1) standards.push(1);
  if (project.applicable2) standards.push(2);
  if (project.applicable3) standards.push(3);
  const candidates: string[] = project.screeningComplete
    ? (JSON.parse(project.mechanismCandidates) as string[])
    : [];

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

  // Compute DT progress per standard
  const dtProgressByStandard = standards.map((std) => {
    const visibleReqs = DT_REQUIREMENTS.filter(
      (r) =>
        candidates.includes(r.mechanismCode) &&
        r.standards.includes(std),
    );

    let totalExpected = 0;
    let totalDone = 0;
    let pass = 0;
    let fail = 0;
    let na = 0;
    let pending = 0;

    for (const req of visibleReqs) {
      const applicability = evaluateRequirementApplicability(req, screeningAnswersMap);
      if (!applicability.applies) {
        totalExpected += 1;
        totalDone += 1;
        na += 1;
        continue;
      }
      if (req.iterateOver) {
        const dedupedKinds = getApplicableKindsFor(req, DT_REQUIREMENTS, standards);
        const assets = matchAssetsForRequirement(req, parsedAssets, dedupedKinds);
        if (assets.length === 0) {
          totalExpected += 1;
          totalDone += 1;
          na += 1;
          continue;
        }
        totalExpected += assets.length;
        for (const a of assets) {
          if (req.naFromRequirement) {
            const linked = project.dtAnswers
              .filter((d) => d.requirementId === req.naFromRequirement!.requirementId && d.assetId === a.id)
              .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
            if (
              evaluateNAFromRequirement(
                req,
                linked,
                requirementById(req.naFromRequirement!.requirementId),
              ).applies
            ) {
              totalDone += 1;
              na += 1;
              continue;
            }
          }
          const answers = answersForAssetReq(project.dtAnswers, a.id, req.id);
          const walk = walkTree(req, answers);
          if (walk.kind === "outcome") {
            totalDone += 1;
            if (walk.outcome === "pass") pass += 1;
            else if (walk.outcome === "fail") fail += 1;
            else na += 1;
          } else {
            pending += 1;
          }
        }
      } else {
        totalExpected += 1;
        if (req.naFromRequirement) {
          const linked = project.dtAnswers
            .filter((d) => d.requirementId === req.naFromRequirement!.requirementId && d.assetId === null)
            .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
          if (
            evaluateNAFromRequirement(
              req,
              linked,
              requirementById(req.naFromRequirement!.requirementId),
            ).applies
          ) {
            totalDone += 1;
            na += 1;
            continue;
          }
        }
        const answers = answersForAssetReq(project.dtAnswers, null, req.id);
        const walk = walkTree(req, answers);
        if (walk.kind === "outcome") {
          totalDone += 1;
          if (walk.outcome === "pass") pass += 1;
          else if (walk.outcome === "fail") fail += 1;
          else na += 1;
        } else {
          pending += 1;
        }
      }
    }

    const pct = totalExpected === 0 ? 0 : Math.round((totalDone / totalExpected) * 100);
    return { std, totalExpected, totalDone, pass, fail, na, pending, pct };
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Read-only banner */}
      <div className="border-b bg-muted/40 px-4 py-2">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <Eye className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            이 페이지는 읽기 전용 공유 보기입니다. / This is a read-only shared view.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 p-4 py-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{project.manufacturer}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {project.finalizedAt ? (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                <Lock className="mr-1 size-3" />
                확정됨 / Finalized
              </Badge>
            ) : (
              <Badge variant="secondary">진행 중 / In Progress</Badge>
            )}
            {standards.map((s) => (
              <Badge key={s} variant="outline">
                EN 18031-{s}
              </Badge>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Package, label: "자산", value: project._count.assets },
            { icon: GitBranch, label: "DT 답변", value: project._count.dtAnswers },
            { icon: FileText, label: "증빙 필드", value: project._count.dtEvidences },
            { icon: Microscope, label: "기능 평가", value: project._count.dtAssessments },
          ].map(({ icon: Icon, label, value }) => (
            <Card key={label}>
              <CardContent className="flex flex-col items-center py-4">
                <Icon className="mb-1.5 size-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{value}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* DT progress per standard */}
        {dtProgressByStandard.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              Decision Tree 진행률 / DT Progress
            </h2>
            {dtProgressByStandard.map(({ std, totalExpected, totalDone, pass, fail, na, pending, pct }) => (
              <Card key={std}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {STANDARDS[std].name_ko}
                  </CardTitle>
                  <CardDescription>{STANDARDS[std].name_en}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span>
                      {totalDone} / {totalExpected} 완료
                    </span>
                    <span className="font-semibold">{pct}%</span>
                  </div>
                  <Progress value={pct} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pass > 0 && (
                      <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="size-3" />
                        PASS {pass}
                      </span>
                    )}
                    {fail > 0 && (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <XCircle className="size-3" />
                        FAIL {fail}
                      </span>
                    )}
                    {na > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MinusCircle className="size-3" />
                        N/A {na}
                      </span>
                    )}
                    {pending > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CircleDashed className="size-3" />
                        미완료 {pending}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Mechanism candidates */}
        {project.screeningComplete && candidates.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                메커니즘 후보 / Mechanism Candidates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((code) => {
                  const m = MECHANISMS.find((x) => x.code === code);
                  return (
                    <Badge key={code} variant="outline" className="font-mono">
                      {code}
                      {m && (
                        <span className="ml-1 font-sans font-normal text-muted-foreground">
                          · {m.name_ko}
                        </span>
                      )}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          이 페이지는 Z-GRC RED에서 생성된 읽기 전용 공유 링크입니다.
          <br />
          This is a read-only share link generated by Z-GRC RED.
        </p>
      </div>
    </div>
  );
}

type AnswerRow = { assetId: string | null; requirementId: string; nodeId: string; answer: string };

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
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export const dynamic = "force-dynamic";
