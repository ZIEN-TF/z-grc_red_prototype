import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Zap,
  Lock,
  Package,
  GitBranch,
  FileText,
  Microscope,
  Paperclip,
  ClipboardList,
  FileBarChart,
  FileCheck2,
  Share2,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const isConsultant = session.role === "consultant";

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      productType: true,
      applicable1: true,
      applicable2: true,
      applicable3: true,
      mechanismCandidates: true,
      screeningComplete: true,
      finalizedAt: true,
      createdAt: true,
      updatedAt: true,
      shareTokens: { select: { id: true } },
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
  });
  if (!project) notFound();

  const standards: number[] = [];
  if (project.applicable1) standards.push(1);
  if (project.applicable2) standards.push(2);
  if (project.applicable3) standards.push(3);
  const mechanisms: string[] = project.screeningComplete
    ? (JSON.parse(project.mechanismCandidates) as string[])
    : [];

  type StepId =
    | "attachments"
    | "screening"
    | "assets"
    | "dt"
    | "evidence"
    | "assessment"
    | "report";

  type StepDef = {
    id: StepId;
    label_ko: string;
    label_en: string;
    path: string;
    icon: React.ComponentType<{ className?: string }>;
    done: boolean;
    optional: boolean;
    detail: string;
    consultantOnly?: boolean;
  };

  const steps: StepDef[] = [
    {
      id: "attachments",
      label_ko: "첨부 파일",
      label_en: "Attachments",
      path: `/projects/${id}/attachments`,
      icon: Paperclip,
      done: project._count.attachments > 0,
      optional: true,
      detail:
        project._count.attachments > 0
          ? `${project._count.attachments}개 파일 업로드됨`
          : "제품 문서·스펙·인증서를 업로드하세요 (선택)",
    },
    {
      id: "screening",
      label_ko: "스크리닝",
      label_en: "Screening",
      path: `/projects/${id}/screening`,
      icon: ClipboardList,
      done: project.screeningComplete,
      optional: false,
      detail: project.screeningComplete
        ? standards.length > 0
          ? `EN 18031-${standards.join("/")} 적용 · ${mechanisms.length}개 메커니즘`
          : "완료 (적용 표준 없음)"
        : "스크리닝 질문에 답해 적용 표준을 확인하세요",
    },
    {
      id: "assets",
      label_ko: "자산 인벤토리",
      label_en: "Assets",
      path: `/projects/${id}/assets`,
      icon: Package,
      done: project._count.assets > 0,
      optional: false,
      detail:
        project._count.assets > 0
          ? `${project._count.assets}개 자산 등록됨`
          : "네트워크 인터페이스·서비스·데이터 흐름을 등록하세요",
    },
    {
      id: "dt",
      label_ko: "Decision Tree 평가",
      label_en: "DT Evaluation",
      path: `/projects/${id}/dt`,
      icon: GitBranch,
      done: project._count.dtAnswers > 0,
      optional: false,
      detail:
        project._count.dtAnswers > 0
          ? `${project._count.dtAnswers}개 DT 답변 기록됨`
          : "각 메커니즘에 대한 결정 트리를 평가하세요",
    },
    {
      id: "evidence",
      label_ko: "증빙 정보 입력",
      label_en: "Evidence",
      path: `/projects/${id}/evidence`,
      icon: FileText,
      done: project._count.dtEvidences > 0,
      optional: false,
      detail:
        project._count.dtEvidences > 0
          ? `${project._count.dtEvidences}개 증빙 필드 입력됨`
          : "요구사항별 E.Info · E.Just 증빙 자료를 입력하세요",
    },
    {
      id: "assessment",
      label_ko: "기능 평가",
      label_en: "Technical Assessment",
      path: `/projects/${id}/assessment`,
      icon: Microscope,
      done: project._count.dtAssessments > 0,
      optional: false,
      consultantOnly: true,
      detail:
        project._count.dtAssessments > 0
          ? `${project._count.dtAssessments}개 평가 기록됨`
          : "컨설턴트가 각 요구사항의 기능 완전성을 평가합니다",
    },
    {
      id: "report",
      label_ko: "최종 리포트",
      label_en: "Final Report",
      path: `/projects/${id}/report`,
      icon: FileBarChart,
      done: !!project.finalizedAt,
      optional: false,
      detail: project.finalizedAt
        ? `확정됨 · ${new Date(project.finalizedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}`
        : "평가를 완료하고 최종 리포트를 확정하세요",
    },
  ];

  const visibleSteps = steps.filter(
    (s) => !s.consultantOnly || isConsultant,
  );

  const requiredVisible = visibleSteps.filter((s) => !s.optional);
  const doneRequired = requiredVisible.filter((s) => s.done).length;
  const progressPct =
    requiredVisible.length === 0
      ? 100
      : project.finalizedAt
        ? 100
        : Math.round((doneRequired / requiredVisible.length) * 100);

  const nextStep = project.finalizedAt
    ? null
    : visibleSteps.find((s) => !s.done && !s.optional);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {project.name}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {project.manufacturer}
          {project.productType && ` · ${project.productType}`}
        </p>
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
            <Badge key={s} variant="outline" className="text-[11px]">
              EN 18031-{s}
            </Badge>
          ))}
          {project.shareTokens.length > 0 && (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              <Share2 className="mr-1 size-2.5" />
              공유 링크 활성
            </Badge>
          )}
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="py-4">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium">전체 진행률 / Overall Progress</span>
            <span className="font-bold">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
          <p className="mt-2 text-xs text-muted-foreground">
            필수 단계 {doneRequired}/{requiredVisible.length} 완료
          </p>
        </CardContent>
      </Card>

      {/* Next Step Callout */}
      {nextStep && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Zap className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-primary">
              다음 단계: {nextStep.label_ko}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {nextStep.detail}
            </p>
          </div>
          <Link href={nextStep.path}>
            <Button size="sm">
              이동
              <ArrowRight className="ml-1 size-3" />
            </Button>
          </Link>
        </div>
      )}

      {project.finalizedAt && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-50/50 p-4 dark:bg-emerald-900/10">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              리포트 확정됨
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(project.finalizedAt).toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })} 확정
            </p>
          </div>
          <Link href={`/projects/${id}/report`}>
            <Button size="sm" variant="outline">
              리포트 보기
              <FileBarChart className="ml-1 size-3" />
            </Button>
          </Link>
        </div>
      )}

      {/* Step list */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            워크플로 단계 / Workflow Steps
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="space-y-1">
            {visibleSteps.map((step) => {
              const Icon = step.icon;
              const isNext = nextStep?.id === step.id;
              return (
                <Link
                  key={step.id}
                  href={step.path}
                  className={cn(
                    "flex items-start gap-3 rounded-lg px-3 py-2.5 transition hover:bg-muted/50",
                    isNext && "bg-primary/5 ring-1 ring-primary/20",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                      step.done
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                        : isNext
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {step.done ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <Icon className="size-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "text-sm font-medium",
                          step.done
                            ? "text-foreground"
                            : isNext
                              ? "text-primary"
                              : "text-muted-foreground",
                        )}
                      >
                        {step.label_ko}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        / {step.label_en}
                      </span>
                      {step.optional && (
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          선택
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {step.detail}
                    </p>
                  </div>
                  <ArrowRight
                    className={cn(
                      "mt-1 size-4 shrink-0",
                      isNext ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Share & metadata */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          최종 수정{" "}
          {new Date(project.updatedAt).toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
        <Link
          href={`/projects/${id}/share`}
          className="flex items-center gap-1 text-primary hover:underline"
        >
          <Share2 className="size-3" />
          공유 링크 관리
        </Link>
      </div>
    </div>
  );
}
