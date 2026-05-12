import Link from "next/link";
import {
  Plus,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Lock,
  Search,
  FileBarChart,
  Microscope,
  FileText,
  GitBranch,
  Package,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { DeleteProjectButton } from "@/app/delete-project-button";

type Filter = "all" | "active" | "finalized";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q, filter: filterParam } = await searchParams;
  const search = (q ?? "").trim();
  const filter: Filter =
    filterParam === "active" || filterParam === "finalized"
      ? filterParam
      : "all";

  const session = await requireSession();
  const isConsultant = session.role === "consultant";
  const projects = await prisma.project.findMany({
    where: isConsultant ? undefined : { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    include: {
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

  const counts = {
    all: projects.length,
    active: projects.filter((p) => !p.finalizedAt).length,
    finalized: projects.filter((p) => !!p.finalizedAt).length,
  };

  const filtered = projects.filter((p) => {
    if (filter === "active" && p.finalizedAt) return false;
    if (filter === "finalized" && !p.finalizedAt) return false;
    if (search) {
      const hay = `${p.name} ${p.manufacturer} ${p.productType ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            프로젝트 목록
            <span className="ml-2 text-lg font-medium text-muted-foreground">
              / Projects
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            RED Art. 3.3 · EN 18031-1/2/3 자가 평가 대상 제품을 관리하세요.
          </p>
        </div>
        <Link href="/projects/new">
          <Button size="lg">
            <Plus className="mr-2 size-4" />
            프로젝트(제품) 추가 / Add Project
          </Button>
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <form action="/" className="relative flex-1 min-w-[220px]">
          <input type="hidden" name="filter" value={filter} />
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="제품명·제조사·유형으로 검색…"
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm"
          />
        </form>
        <div className="flex gap-1">
          <FilterLink filter="all" current={filter} search={search}>
            전체 ({counts.all})
          </FilterLink>
          <FilterLink filter="active" current={filter} search={search}>
            진행중 ({counts.active})
          </FilterLink>
          <FilterLink filter="finalized" current={filter} search={search}>
            확정 ({counts.finalized})
          </FilterLink>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="rounded-full bg-primary/10 p-4 text-primary">
              {projects.length === 0 ? (
                <Plus className="size-8" />
              ) : (
                <Search className="size-8" />
              )}
            </div>
            <div>
              <p className="text-base font-medium">
                {projects.length === 0
                  ? "등록된 프로젝트가 없습니다."
                  : "조건에 맞는 프로젝트가 없습니다."}
              </p>
              <p className="text-sm text-muted-foreground">
                {projects.length === 0
                  ? "No projects yet — add one to get started."
                  : "검색어 또는 필터를 변경해 보세요."}
              </p>
            </div>
            {projects.length === 0 && (
              <Link href="/projects/new">
                <Button>
                  <Plus className="mr-2 size-4" />
                  프로젝트 추가 / Add Project
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} isConsultant={isConsultant} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterLink({
  filter,
  current,
  search,
  children,
}: {
  filter: Filter;
  current: Filter;
  search: string;
  children: React.ReactNode;
}) {
  const active = filter === current;
  const qs = new URLSearchParams();
  if (search) qs.set("q", search);
  if (filter !== "all") qs.set("filter", filter);
  const href = qs.toString() ? `/?${qs.toString()}` : "/";
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

type ProjectData = {
  id: string;
  name: string;
  manufacturer: string;
  applicable1: boolean;
  applicable2: boolean;
  applicable3: boolean;
  screeningComplete: boolean;
  finalizedAt: Date | null;
  mechanismCandidates: string;
  updatedAt: Date;
  _count: {
    assets: number;
    dtAnswers: number;
    dtEvidences: number;
    dtAssessments: number;
    attachments: number;
  };
};

function ProjectCard({
  project: p,
  isConsultant,
}: {
  project: ProjectData;
  isConsultant: boolean;
}) {
  const standards: number[] = [];
  if (p.applicable1) standards.push(1);
  if (p.applicable2) standards.push(2);
  if (p.applicable3) standards.push(3);
  const mechanisms: string[] = p.screeningComplete
    ? (JSON.parse(p.mechanismCandidates) as string[])
    : [];

  const progress = computeProgress(p);
  const status = computeStatus(p, isConsultant);

  return (
    <Card className={cn("flex flex-col", p.finalizedAt && "border-emerald-500/40")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{p.name}</CardTitle>
            <CardDescription className="truncate">{p.manufacturer}</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <StatusBadge status={status} />
            <DeleteProjectButton projectId={p.id} projectName={p.name} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>진행률</span>
            <span className="font-medium text-foreground">{progress.percent}%</span>
          </div>
          <Progress value={progress.percent} className="h-1.5" />
          <p className="text-[11px] text-foreground">{status.detail}</p>
          {progress.label !== "확정 대기" &&
            progress.label !== "리포트 확정됨" &&
            status.key !== "finalized" && (
              <p className="text-[10px] text-muted-foreground">{progress.label}</p>
            )}
        </div>

        {p.screeningComplete && (
          <div className="flex flex-wrap gap-1">
            {standards.length === 0 ? (
              <Badge variant="outline" className="text-[10px]">
                해당 표준 없음
              </Badge>
            ) : (
              standards.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">
                  EN 18031-{s}
                </Badge>
              ))
            )}
            {mechanisms.slice(0, 6).map((m) => (
              <Badge key={m} variant="outline" className="font-mono text-[10px]">
                {m}
              </Badge>
            ))}
            {mechanisms.length > 6 && (
              <Badge variant="outline" className="text-[10px]">
                +{mechanisms.length - 6}
              </Badge>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
          <Stat icon={Package} label="자산" value={p._count.assets} />
          <Stat icon={GitBranch} label="DT" value={p._count.dtAnswers} />
          <Stat icon={FileText} label="증빙" value={p._count.dtEvidences} />
          <Stat icon={Microscope} label="평가" value={p._count.dtAssessments} />
        </div>

        <p className="text-[10px] text-muted-foreground">
          최종 수정{" "}
          {new Date(p.updatedAt).toLocaleDateString("ko-KR", {
            month: "short",
            day: "numeric",
          })}
        </p>

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <Link
            href={
              p.finalizedAt
                ? `/projects/${p.id}/report`
                : p.screeningComplete
                  ? `/projects/${p.id}/result`
                  : `/projects/${p.id}/screening`
            }
          >
            <Button variant="outline" className="w-full">
              {p.finalizedAt ? (
                <>
                  <FileBarChart className="mr-2 size-4" />
                  리포트 보기
                </>
              ) : p.screeningComplete ? (
                <>
                  결과 보기 / View Result
                  <ArrowRight className="ml-2 size-4" />
                </>
              ) : (
                <>
                  스크리닝 시작 / Start Screening
                  <ArrowRight className="ml-2 size-4" />
                </>
              )}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded bg-muted/40 py-1">
      <Icon className="size-3" />
      <span className="font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </div>
  );
}

type StatusKey =
  | "draft"
  | "inputting"
  | "review_pending"
  | "in_review"
  | "ready_to_finalize"
  | "finalized";

type StatusInfo = {
  key: StatusKey;
  /** Short label shown on the badge */
  label: string;
  /** Longer phrase shown under the progress bar */
  detail: string;
  tone: "default" | "secondary" | "outline" | "success" | "warn";
};

function computeStatus(p: ProjectData, isConsultant: boolean): StatusInfo {
  if (p.finalizedAt) {
    return {
      key: "finalized",
      label: "확정",
      detail: "리포트가 확정되었습니다.",
      tone: "success",
    };
  }
  if (!p.screeningComplete) {
    return {
      key: "draft",
      label: "초안",
      detail: "스크리닝을 먼저 진행해 주세요.",
      tone: "outline",
    };
  }

  const hasDT = p._count.dtAnswers > 0;
  const hasEvidence = p._count.dtEvidences > 0;
  const hasAssessment = p._count.dtAssessments > 0;

  // Customer-side work appears done → consultant's turn.
  if (hasDT && hasEvidence && !hasAssessment) {
    return {
      key: "review_pending",
      label: isConsultant ? "검토 필요" : "컨설턴트 검토 대기",
      detail: isConsultant
        ? "고객 입력이 완료되었습니다. 기능 평가를 시작하세요."
        : "컨설턴트 검토를 기다리고 있습니다.",
      tone: "warn",
    };
  }

  // Consultant is assessing
  if (hasAssessment) {
    return {
      key: "in_review",
      label: isConsultant ? "평가 진행 중" : "컨설턴트 평가 중",
      detail: isConsultant
        ? "평가를 진행한 후 리포트를 확정하세요."
        : "컨설턴트가 기능 평가를 진행 중입니다.",
      tone: "secondary",
    };
  }

  // Still in customer input phase
  return {
    key: "inputting",
    label: "입력 진행 중",
    detail:
      !hasDT
        ? "Decision Tree 평가를 진행해 주세요."
        : "증빙 정보를 입력해 주세요.",
    tone: "secondary",
  };
}

function StatusBadge({ status }: { status: StatusInfo }) {
  const { tone, label, key } = status;
  if (tone === "success")
    return (
      <Badge className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-600">
        <Lock className="mr-1 size-3" />
        {label}
      </Badge>
    );
  if (tone === "warn")
    return (
      <Badge
        variant="secondary"
        className="shrink-0 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
      >
        {key === "review_pending" && "● "}
        {label}
      </Badge>
    );
  if (tone === "outline")
    return (
      <Badge variant="outline" className="shrink-0">
        {label}
      </Badge>
    );
  return (
    <Badge variant="secondary" className="shrink-0">
      {label}
    </Badge>
  );
}

function computeProgress(p: ProjectData): { percent: number; label: string } {
  if (p.finalizedAt) {
    return { percent: 100, label: "리포트 확정됨" };
  }
  // Weighted heuristic: 6 milestones
  let score = 0;
  const steps: string[] = [];
  if (p.screeningComplete) {
    score += 15;
  } else {
    steps.push("스크리닝");
  }
  if (p._count.assets > 0) {
    score += 15;
  } else if (p.screeningComplete) {
    steps.push("자산 등록");
  }
  if (p._count.dtAnswers > 0) score += 25;
  else if (p.screeningComplete) steps.push("DT 평가");
  if (p._count.dtEvidences > 0) score += 20;
  else if (p._count.dtAnswers > 0) steps.push("증빙 입력");
  if (p._count.dtAssessments > 0) score += 25;
  else if (p._count.dtAnswers > 0) steps.push("기능 평가");

  const label =
    score === 0
      ? "시작 전"
      : steps.length === 0
        ? "확정 대기"
        : `다음: ${steps[0]}`;
  return { percent: Math.min(score, 99), label };
}

// Needed so that date-based ordering refreshes the page on SSR
export const dynamic = "force-dynamic";
