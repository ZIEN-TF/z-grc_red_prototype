import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ScreeningForm } from "./screening-form";
import { SCREENING_QUESTIONS } from "@/lib/screening-questions";
import { LockedBanner } from "../locked-banner";
import { ResetScreeningDialog } from "./reset-screening-dialog";

export default async function ScreeningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      screeningAnswers: true,
      _count: {
        select: {
          dtAnswers: true,
          dtEvidences: true,
          dtAssessments: true,
        },
      },
    },
  });
  if (!project) notFound();

  const savedAnswers: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no") {
      savedAnswers[a.questionId] = a.answer;
    }
  }

  const hasDownstream =
    project._count.dtAnswers > 0 ||
    project._count.dtEvidences > 0 ||
    project._count.dtAssessments > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/">
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            뒤로 / Back
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          적용성 스크리닝
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Applicability Screening
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          제품: <span className="font-medium text-foreground">{project.name}</span>
          {" · "}
          {project.manufacturer}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          각 질문에 Yes/No로 답해 주세요. 답변 결과에 따라 EN 18031-1/2/3 적용 여부와 필요한 메커니즘 후보가 결정됩니다.
          <br />
          Answer Yes/No for each question. Your answers determine applicability of EN 18031-1/2/3 and candidate mechanisms.
        </p>
      </div>

      <LockedBanner
        projectId={project.id}
        finalizedAt={project.finalizedAt}
        finalizedBy={project.finalizedBy}
      />

      {hasDownstream && !project.finalizedAt && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-300">
                이 프로젝트는 이미 이후 단계 데이터가 입력되어 있습니다.
              </p>
              <p className="mt-0.5 text-muted-foreground">
                DT 답변 {project._count.dtAnswers}건 · 증빙 {project._count.dtEvidences}건 · 기능 평가 {project._count.dtAssessments}건.
                <br />
                스크리닝 답변을 변경하면 적용 표준·메커니즘 구성이 달라져 기존 입력이 유효하지 않을 수 있습니다.
                완전히 처음부터 다시 하려면 아래 버튼으로 전체 초기화하세요.
              </p>
            </div>
          </div>
          <ResetScreeningDialog projectId={project.id} />
        </div>
      )}

      <ScreeningForm
        projectId={project.id}
        questions={SCREENING_QUESTIONS}
        initialAnswers={savedAnswers}
        readOnly={project.finalizedAt !== null}
        canUseAi={session.role === "consultant"}
      />
    </div>
  );
}
