import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  MinusCircle,
  CircleDashed,
  CircleAlert,
  FileText,
  Paperclip,
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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MECHANISMS, STANDARDS, type StandardId } from "@/lib/mechanisms";
import { kindConfig } from "@/lib/asset-kinds";
import {
  DT_REQUIREMENTS,
  evaluateRequirementApplicability,
  evaluateNAFromRequirement,
  requirementById,
  getApplicableKindsFor,
  matchAssetsForRequirement,
  walkTree,
  buildPathSummary,
  assessmentsFor,
  ASSESSMENT_LABEL_KO,
  type DTOutcome,
  type DTRequirement,
  type EvidenceField,
  type AssessmentType,
  type NodeAnswer,
} from "@/lib/decision-trees";
import { PrintButton } from "./print-button";
import { FinalizeControls } from "./finalize-banner";
import { DownloadPdfButton } from "./download-pdf-button";
import { requireSession } from "@/lib/auth";

type IterationStatus = DTOutcome | "incomplete" | "auto_na";
type VerdictValue = "pass" | "fail" | "not_applicable" | null;

type IterationBlock = {
  assetId: string | null;
  assetLabel: string | null;
  assetKind: string | null;
  status: IterationStatus;
  pathSummary: string;
  autoNAReason?: string;
  evidenceFields: Array<{ field: EvidenceField; value: string }>;
  legacyNotes: Array<{
    nodeId: string;
    prompt_ko: string;
    notes: string;
    answer: NodeAnswer;
  }>;
  assessments: Array<{
    type: AssessmentType;
    testMethod: string;
    testResult: string;
    verdict: VerdictValue;
  }>;
};

type RequirementBlock = {
  req: DTRequirement;
  iterations: IterationBlock[];
  /** Derived: overall status across iterations (worst-case for the summary). */
  aggregateStatus: IterationStatus;
};

type StandardStats = {
  total: number;
  pass: number;
  fail: number;
  na: number;
  pending: number;
};

type StandardSection = {
  standard: StandardId;
  blocks: RequirementBlock[];
  assets: Array<{ id: string; name: string; kind: string; description: string | null }>;
  stats: StandardStats;
  incomplete: Array<{ reqId: string; reason: string }>;
};

const TAB_VALUES = ["summary", "p1", "p2", "p3"] as const;
type TabValue = (typeof TAB_VALUES)[number];

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const session = await requireSession();
  const isConsultant = session.role === "consultant";

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      assets: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      dtAnswers: true,
      dtEvidences: true,
      dtAssessments: true,
      screeningAnswers: true,
    },
  });
  if (!project) notFound();

  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);

  const activeTab = resolveTab(tabParam, applicableStandards);

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
              <Button className="mt-4">스크리닝 진행</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const candidates: string[] = JSON.parse(project.mechanismCandidates);
  const screeningMap: Record<string, "yes" | "no"> = {};
  for (const a of project.screeningAnswers) {
    if (a.answer === "yes" || a.answer === "no")
      screeningMap[a.questionId] = a.answer;
  }

  const parsedAssets = project.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    description: a.description,
    metadata: safeJson(a.metadata),
  }));

  const evidenceMap = new Map<string, string>();
  for (const ev of project.dtEvidences) {
    const key = `${ev.requirementId}::${ev.assetId ?? "__global__"}::${ev.fieldId}`;
    evidenceMap.set(key, ev.value);
  }

  const assessmentMap = new Map<string, { testMethod: string; testResult: string; verdict: VerdictValue }>();
  for (const a of project.dtAssessments) {
    const key = `${a.requirementId}::${a.assetId ?? "__global__"}::${a.assessmentType}`;
    assessmentMap.set(key, {
      testMethod: a.testMethod,
      testResult: a.testResult,
      verdict:
        a.verdict === "pass" || a.verdict === "fail" || a.verdict === "not_applicable"
          ? a.verdict
          : null,
    });
  }

  // Build per-standard sections
  const sections: Record<number, StandardSection> = {};
  for (const std of applicableStandards) {
    sections[std] = buildSection({
      standard: std,
      candidates,
      screeningMap,
      applicableStandards,
      parsedAssets,
      dtAnswers: project.dtAnswers,
      evidenceMap,
      assessmentMap,
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link href={`/projects/${project.id}/assessment`}>
            <Button variant="ghost" size="sm" className="-ml-3">
              <ArrowLeft className="mr-1 size-4" />
              기능 평가
            </Button>
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            최종 리포트
            <span className="ml-2 text-base font-medium text-muted-foreground">
              / Final Report
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DownloadPdfButton projectId={project.id} />
          <PrintButton />
        </div>
      </div>

      {isConsultant ? (
        <FinalizeControls
          projectId={project.id}
          finalizedAt={project.finalizedAt ? project.finalizedAt.toISOString() : null}
          finalizedBy={project.finalizedBy}
          finalizedNote={project.finalizedNote}
        />
      ) : project.finalizedAt ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            ✓ 이 리포트는 컨설턴트에 의해 확정되었습니다.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(project.finalizedAt).toLocaleString("ko-KR")}
            {project.finalizedBy && ` · ${project.finalizedBy}`}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50/60 p-4 dark:bg-amber-950/20">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            ⏳ 컨설턴트의 기능 평가가 진행 중입니다.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            평가가 완료되면 기능 평가 내용과 최종 확정이 리포트에 반영됩니다.
          </p>
        </div>
      )}

      {/* Print header (visible only when printing) */}
      <div className="hidden print:mb-6 print:block">
        <h1 className="text-2xl font-bold">EN 18031 자가 평가 리포트 / Self-Assessment Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          생성일 / Generated: {new Date().toLocaleString("ko-KR")}
        </p>
      </div>

      <ProjectHeaderCard project={project} applicable={applicableStandards} />

      <div className="flex flex-wrap gap-1 border-b print:hidden">
        <TabLink
          tab="summary"
          active={activeTab === "summary"}
          projectId={project.id}
        >
          전체 요약
        </TabLink>
        {applicableStandards.map((s) => {
          const tab: TabValue = `p${s}` as TabValue;
          return (
            <TabLink
              key={s}
              tab={tab}
              active={activeTab === tab}
              projectId={project.id}
            >
              EN 18031-{s}
            </TabLink>
          );
        })}
      </div>

      {/* When printing, show all sections concatenated */}
      <div className="print:hidden">
        {activeTab === "summary" ? (
          <SummaryTab
            project={project}
            applicable={applicableStandards}
            sections={sections}
          />
        ) : (
          <StandardTab
            standard={tabToStandard(activeTab)!}
            section={sections[tabToStandard(activeTab)!]}
            hideAssessments={!isConsultant}
            showAssessmentPlaceholder={!isConsultant}
          />
        )}
      </div>

      <div className="hidden space-y-6 print:block">
        <SummaryTab
          project={project}
          applicable={applicableStandards}
          sections={sections}
        />
        {applicableStandards.map((s) => (
          <div key={s} className="break-before-page">
            <h2 className="mb-4 text-xl font-bold">
              EN 18031-{s} — {STANDARDS[s].name_ko}
            </h2>
            <StandardTab
              standard={s}
              section={sections[s]}
              hideAssessments={!isConsultant}
              showAssessmentPlaceholder={!isConsultant}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function resolveTab(param: string | undefined, applicable: StandardId[]): TabValue {
  if (!param) return "summary";
  if (param === "summary") return "summary";
  if ((param === "p1" && applicable.includes(1)) ||
      (param === "p2" && applicable.includes(2)) ||
      (param === "p3" && applicable.includes(3))) {
    return param as TabValue;
  }
  return "summary";
}

function tabToStandard(tab: TabValue): StandardId | null {
  if (tab === "p1") return 1;
  if (tab === "p2") return 2;
  if (tab === "p3") return 3;
  return null;
}

function TabLink({
  tab,
  active,
  projectId,
  children,
}: {
  tab: TabValue;
  active: boolean;
  projectId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/projects/${projectId}/report?tab=${tab}`}
      className={cn(
        "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition -mb-px",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function ProjectHeaderCard({
  project,
  applicable,
}: {
  project: {
    name: string;
    manufacturer: string;
    contactName: string | null;
    contactEmail: string | null;
    productType: string | null;
    productDescription: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  applicable: StandardId[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{project.name}</CardTitle>
        <CardDescription>{project.manufacturer}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
        {project.productType && (
          <div>
            <span className="text-xs text-muted-foreground">제품 유형</span>
            <p>{project.productType}</p>
          </div>
        )}
        {project.contactName && (
          <div>
            <span className="text-xs text-muted-foreground">담당자</span>
            <p>
              {project.contactName}
              {project.contactEmail && (
                <span className="ml-2 text-xs text-muted-foreground">
                  &lt;{project.contactEmail}&gt;
                </span>
              )}
            </p>
          </div>
        )}
        {project.productDescription && (
          <div className="sm:col-span-2">
            <span className="text-xs text-muted-foreground">제품 설명</span>
            <p className="whitespace-pre-line">{project.productDescription}</p>
          </div>
        )}
        <div className="sm:col-span-2">
          <span className="text-xs text-muted-foreground">적용 표준</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {applicable.length === 0 ? (
              <span className="text-muted-foreground">없음</span>
            ) : (
              applicable.map((s) => (
                <Badge key={s} variant="secondary">
                  EN 18031-{s} · {STANDARDS[s].name_ko}
                </Badge>
              ))
            )}
          </div>
        </div>
        <div className="sm:col-span-2 text-xs text-muted-foreground">
          생성일 {new Date(project.createdAt).toLocaleDateString("ko-KR")} · 최종 수정{" "}
          {new Date(project.updatedAt).toLocaleDateString("ko-KR")}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryTab({
  project,
  applicable,
  sections,
}: {
  project: {
    id: string;
    attachments: Array<{
      id: string;
      filename: string;
      description: string;
      mimeType: string;
    }>;
  };
  applicable: StandardId[];
  sections: Record<number, StandardSection>;
}) {
  return (
    <div className="space-y-6">
      {applicable.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            스크리닝 결과 적용 대상 표준이 없습니다.
          </CardContent>
        </Card>
      ) : (
        applicable.map((s) => (
          <StandardSummaryCard key={s} standard={s} section={sections[s]} />
        ))
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Paperclip className="size-4" />
            첨부 파일 ({project.attachments.length}개)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {project.attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 파일이 없습니다.</p>
          ) : (
            project.attachments.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-sm">
                <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline print:text-foreground print:no-underline"
                  >
                    {a.filename}
                  </a>
                  {a.description && (
                    <p className="text-xs text-muted-foreground">{a.description}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {applicable.some((s) => sections[s].incomplete.length > 0) && (
        <details className="group rounded-lg border border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-amber-50/70 dark:hover:bg-amber-950/30">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <CircleAlert className="size-4" />
              <span className="text-base font-semibold">미완료 항목</span>
              <Badge
                variant="outline"
                className="border-amber-500/50 text-[10px] text-amber-800 dark:text-amber-300"
              >
                {applicable.reduce(
                  (sum, s) => sum + sections[s].incomplete.length,
                  0,
                )}
                건
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">
                펼쳐서 확인
              </span>
              <span className="inline-block size-1.5 rotate-0 rounded-sm border-b-2 border-r-2 border-amber-700 transition-transform group-open:rotate-45 dark:border-amber-400" />
            </div>
          </summary>
          <div className="space-y-3 border-t border-amber-500/30 p-4">
            <p className="text-xs text-muted-foreground">
              리포트 확정 전에 확인이 필요한 항목입니다.
            </p>
            {applicable.map((s) => {
              const section = sections[s];
              if (section.incomplete.length === 0) return null;
              return (
                <div key={s}>
                  <p className="text-xs font-medium text-foreground">
                    EN 18031-{s} ({section.incomplete.length}건)
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {section.incomplete.map((inc, idx) => (
                      <li key={`${inc.reqId}-${idx}`}>
                        <span className="font-mono text-[10px] text-foreground/80">
                          {inc.reqId}
                        </span>{" "}
                        — {inc.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function StandardSummaryCard({
  standard,
  section,
}: {
  standard: StandardId;
  section: StandardSection;
}) {
  const { stats } = section;
  const resolved = stats.pass + stats.fail + stats.na;
  const pct = stats.total === 0 ? 0 : Math.round((resolved / stats.total) * 100);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          EN 18031-{standard}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {STANDARDS[standard].name_ko}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          <StatBlock label="전체" count={stats.total} tone="muted" />
          <StatBlock label="PASS" count={stats.pass} tone="pass" />
          <StatBlock label="FAIL" count={stats.fail} tone="fail" />
          <StatBlock label="N/A" count={stats.na} tone="na" />
          <StatBlock label="진행중" count={stats.pending} tone="pending" />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>완료율</span>
            <span className="font-medium text-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="mt-1 h-1.5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "muted" | "pass" | "fail" | "na" | "pending";
}) {
  const toneClass =
    tone === "pass"
      ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
      : tone === "fail"
        ? "bg-destructive/10 text-destructive"
        : tone === "na"
          ? "bg-muted text-muted-foreground"
          : tone === "pending"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "bg-muted text-foreground";
  return (
    <div className={cn("rounded-md px-2 py-2", toneClass)}>
      <div className="text-lg font-bold leading-none">{count}</div>
      <div className="mt-0.5 text-[10px]">{label}</div>
    </div>
  );
}

function StandardTab({
  standard,
  section,
  hideAssessments = false,
  showAssessmentPlaceholder = false,
}: {
  standard: StandardId;
  section: StandardSection;
  hideAssessments?: boolean;
  showAssessmentPlaceholder?: boolean;
}) {
  if (!section) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          이 표준은 적용 대상이 아닙니다.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {/* Summary + asset list */}
      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <StandardSummaryCard standard={standard} section={section} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">대상 자산 ({section.assets.length}개)</CardTitle>
            <CardDescription className="text-xs">
              이 표준의 요구사항에 반복 평가되는 자산입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {section.assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">해당 자산 없음</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {section.assets.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {kindConfig(a.kind)?.title_ko ?? a.kind}
                    </Badge>
                    <span className="truncate">{a.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-requirement blocks */}
      {section.blocks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            이 표준에 해당하는 요구사항이 없습니다.
          </CardContent>
        </Card>
      ) : (
        section.blocks.map((block) => (
          <RequirementBlockCard
            key={block.req.id}
            block={block}
            hideAssessments={hideAssessments}
            showAssessmentPlaceholder={showAssessmentPlaceholder}
          />
        ))
      )}
    </div>
  );
}

function RequirementBlockCard({
  block,
  hideAssessments = false,
  showAssessmentPlaceholder = false,
}: {
  block: RequirementBlock;
  hideAssessments?: boolean;
  showAssessmentPlaceholder?: boolean;
}) {
  const mech = MECHANISMS.find((m) => m.code === block.req.mechanismCode);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                {block.req.id}
              </span>
              <span>{block.req.title_ko}</span>
            </CardTitle>
            <CardDescription className="mt-1">
              {mech?.name_ko} / {block.req.clause}
            </CardDescription>
          </div>
          <IterationStatusBadge status={block.aggregateStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {block.iterations.map((it) => (
          <IterationCard
            key={`${block.req.id}-${it.assetId ?? "global"}`}
            requirement={block.req}
            iteration={it}
            hideAssessments={hideAssessments}
            showAssessmentPlaceholder={showAssessmentPlaceholder}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function IterationCard({
  requirement,
  iteration,
  hideAssessments = false,
  showAssessmentPlaceholder = false,
}: {
  requirement: DTRequirement;
  iteration: IterationBlock;
  hideAssessments?: boolean;
  showAssessmentPlaceholder?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          {iteration.assetLabel ? (
            <>
              <span className="font-medium">
                {iteration.assetLabel.split(" · ")[0]}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {iteration.assetLabel.split(" · ").slice(1).join(" · ")}
              </span>
            </>
          ) : (
            <span className="font-medium">기기 전체</span>
          )}
        </div>
        <IterationStatusBadge status={iteration.status} />
      </div>

      {/* DT path summary */}
      {iteration.pathSummary && (
        <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <div className="text-[10px] font-medium text-primary">
            Decision Tree 경로
          </div>
          <code className="mt-0.5 block break-all font-mono text-[11px] text-foreground">
            {iteration.pathSummary || "—"}
          </code>
        </div>
      )}

      {/* Auto-NA notice */}
      {iteration.status === "auto_na" && iteration.autoNAReason && (
        <p className="mb-3 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {iteration.autoNAReason}
        </p>
      )}

      {/* Evidence (structured) */}
      {iteration.evidenceFields.length > 0 && (
        <section className="mb-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            증빙 정보 / Required Information
          </h4>
          <div className="space-y-2">
            {iteration.evidenceFields.map(({ field, value }) => (
              <div
                key={field.id}
                className="rounded-md border bg-muted/20 p-2.5"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <code className="font-mono text-[10px] text-muted-foreground">
                    {field.id}
                  </code>
                  {field.required && !value && (
                    <Badge variant="outline" className="text-[9px] text-destructive">
                      미입력
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {field.prompt_ko}
                </p>
                <p className="mt-1 whitespace-pre-line text-xs">
                  {value || (
                    <span className="italic text-muted-foreground">
                      (미입력)
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Legacy notes (for reqs without evidenceFields) */}
      {iteration.legacyNotes.length > 0 && (
        <section className="mb-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            증빙 메모 / Notes
          </h4>
          <div className="space-y-2">
            {iteration.legacyNotes.map((n) => (
              <div key={n.nodeId} className="rounded-md border bg-muted/20 p-2.5">
                <div className="mb-1 text-[10px] font-mono text-muted-foreground">
                  {n.nodeId} · {n.answer.toUpperCase()}
                </div>
                <p className="text-[11px] text-muted-foreground">{n.prompt_ko}</p>
                <p className="mt-1 whitespace-pre-line text-xs">
                  {n.notes || (
                    <span className="italic text-muted-foreground">(미입력)</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Assessment placeholder for customer view */}
      {hideAssessments && showAssessmentPlaceholder && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            기능 평가 / Technical Assessment
          </h4>
          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs italic text-muted-foreground">
            컨설턴트 평가 중입니다. 평가가 완료되면 본 섹션에 내용이 표시됩니다.
          </div>
        </section>
      )}

      {/* Assessments */}
      {!hideAssessments && iteration.assessments.length > 0 && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            기능 평가 / Technical Assessment
          </h4>
          <div className="space-y-2">
            {iteration.assessments.map((a) => (
              <div key={a.type} className="rounded-md border bg-muted/20 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px]",
                      a.type === "completeness" && "bg-blue-500/15 text-blue-700 dark:text-blue-400",
                      a.type === "sufficiency" && "bg-violet-500/15 text-violet-700 dark:text-violet-400",
                      a.type === "conceptual_completeness" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {ASSESSMENT_LABEL_KO[a.type]}
                  </Badge>
                  <VerdictBadge verdict={a.verdict} />
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground">
                      테스트 방법
                    </div>
                    <p className="mt-0.5 whitespace-pre-line">
                      {a.testMethod || (
                        <span className="italic text-muted-foreground">
                          (미입력)
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground">
                      테스트 결과
                    </div>
                    <p className="mt-0.5 whitespace-pre-line">
                      {a.testResult || (
                        <span className="italic text-muted-foreground">
                          (미입력)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {requirement.evidenceFields === undefined && iteration.legacyNotes.length === 0 && iteration.evidenceFields.length === 0 && iteration.assessments.length === 0 && (
        <p className="text-xs italic text-muted-foreground">증빙·평가 입력 없음</p>
      )}
    </div>
  );
}

function IterationStatusBadge({ status }: { status: IterationStatus }) {
  if (status === "pass")
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 size-3" />
        PASS
      </Badge>
    );
  if (status === "fail")
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 size-3" />
        FAIL
      </Badge>
    );
  if (status === "not_applicable" || status === "auto_na")
    return (
      <Badge variant="secondary">
        <MinusCircle className="mr-1 size-3" />
        {status === "auto_na" ? "N/A (자동)" : "N/A"}
      </Badge>
    );
  return (
    <Badge variant="outline">
      <CircleDashed className="mr-1 size-3" />
      진행중
    </Badge>
  );
}

function VerdictBadge({ verdict }: { verdict: VerdictValue }) {
  if (!verdict)
    return (
      <Badge variant="outline" className="text-[10px]">
        미판정
      </Badge>
    );
  if (verdict === "pass")
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px]">
        Pass
      </Badge>
    );
  if (verdict === "fail")
    return <Badge variant="destructive" className="text-[10px]">Fail</Badge>;
  return (
    <Badge variant="secondary" className="text-[10px]">
      N/A
    </Badge>
  );
}

type BuildSectionArgs = {
  standard: StandardId;
  candidates: string[];
  screeningMap: Record<string, "yes" | "no">;
  applicableStandards: StandardId[];
  parsedAssets: Array<{
    id: string;
    kind: string;
    name: string;
    description: string | null;
    metadata: Record<string, string>;
  }>;
  dtAnswers: Array<{
    requirementId: string;
    assetId: string | null;
    nodeId: string;
    answer: string;
    notes: string | null;
  }>;
  evidenceMap: Map<string, string>;
  assessmentMap: Map<string, { testMethod: string; testResult: string; verdict: VerdictValue }>;
};

function buildSection(args: BuildSectionArgs): StandardSection {
  const {
    standard,
    candidates,
    screeningMap,
    applicableStandards,
    parsedAssets,
    dtAnswers,
    evidenceMap,
    assessmentMap,
  } = args;

  const visibleReqs = DT_REQUIREMENTS.filter(
    (r) =>
      candidates.includes(r.mechanismCode) &&
      r.standards.includes(standard) &&
      evaluateRequirementApplicability(r, screeningMap).applies,
  );

  const blocks: RequirementBlock[] = [];
  const incomplete: Array<{ reqId: string; reason: string }> = [];
  const assetsUsed = new Set<string>();
  const stats: StandardStats = { total: 0, pass: 0, fail: 0, na: 0, pending: 0 };

  for (const req of visibleReqs) {
    const assessTypes = assessmentsFor(req.id);
    const iterations: IterationBlock[] = [];

    if (req.iterateOver) {
      const dedupedKinds = getApplicableKindsFor(
        req,
        DT_REQUIREMENTS,
        applicableStandards,
      );
      const matching = matchAssetsForRequirement(req, parsedAssets, dedupedKinds);
      for (const a of matching) {
        // Auto-NA via naFromRequirement
        let autoNA = false;
        let autoNAReason: string | undefined;
        if (req.naFromRequirement) {
          const linked = dtAnswers
            .filter(
              (d) =>
                d.requirementId === req.naFromRequirement!.requirementId &&
                d.assetId === a.id,
            )
            .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
          const res = evaluateNAFromRequirement(
            req,
            linked,
            requirementById(req.naFromRequirement!.requirementId),
          );
          if (res.applies) {
            autoNA = true;
            autoNAReason = req.naFromRequirement.reason_ko;
          }
        }

        if (autoNA) {
          iterations.push(
            emptyIter(
              a.id,
              `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
              a.kind,
              "auto_na",
              "",
              autoNAReason,
            ),
          );
          assetsUsed.add(a.id);
          continue;
        }

        const answers = collectAnswers(dtAnswers, req.id, a.id);
        const iter = buildIter({
          req,
          assetId: a.id,
          assetLabel: `${a.name} · ${kindConfig(a.kind)?.title_ko ?? a.kind}`,
          assetKind: a.kind,
          answers,
          dtAnswers,
          evidenceMap,
          assessmentMap,
          assessTypes,
        });
        iterations.push(iter);
        assetsUsed.add(a.id);
      }
    } else {
      // Global requirement
      let autoNA = false;
      let autoNAReason: string | undefined;
      if (req.naFromRequirement) {
        const linked = dtAnswers
          .filter(
            (d) =>
              d.requirementId === req.naFromRequirement!.requirementId &&
              d.assetId === null,
          )
          .map((d) => ({ nodeId: d.nodeId, answer: d.answer as NodeAnswer }));
        const res = evaluateNAFromRequirement(
          req,
          linked,
          requirementById(req.naFromRequirement!.requirementId),
        );
        if (res.applies) {
          autoNA = true;
          autoNAReason = req.naFromRequirement.reason_ko;
        }
      }

      if (autoNA) {
        iterations.push(
          emptyIter(null, null, null, "auto_na", "", autoNAReason),
        );
      } else {
        const answers = collectAnswers(dtAnswers, req.id, null);
        iterations.push(
          buildIter({
            req,
            assetId: null,
            assetLabel: null,
            assetKind: null,
            answers,
            dtAnswers,
            evidenceMap,
            assessmentMap,
            assessTypes,
          }),
        );
      }
    }

    // Stats + incomplete detection
    let aggregateStatus: IterationStatus = "incomplete";
    for (const it of iterations) {
      stats.total++;
      if (it.status === "pass") {
        stats.pass++;
        if (aggregateStatus === "incomplete") aggregateStatus = "pass";
      } else if (it.status === "fail") {
        stats.fail++;
        aggregateStatus = "fail"; // worst-case
      } else if (it.status === "not_applicable" || it.status === "auto_na") {
        stats.na++;
        if (aggregateStatus === "incomplete") aggregateStatus = "not_applicable";
      } else {
        stats.pending++;
        aggregateStatus = aggregateStatus === "fail" ? "fail" : "incomplete";
      }

      // Check for missing required evidence
      if (it.status === "pass" || it.status === "fail") {
        const missingRequired = it.evidenceFields.filter(
          (f) => f.field.required && !f.value.trim(),
        );
        if (missingRequired.length > 0) {
          incomplete.push({
            reqId: req.id,
            reason: `증빙 필수 필드 미입력 (${missingRequired.length}건)${it.assetLabel ? ` — ${it.assetLabel.split(" · ")[0]}` : ""}`,
          });
        }
        // Check for missing verdicts on assessments
        const missingVerdicts = it.assessments.filter((a) => a.verdict === null);
        if (missingVerdicts.length > 0) {
          incomplete.push({
            reqId: req.id,
            reason: `기능 평가 판정 미입력 (${missingVerdicts.length}건)${it.assetLabel ? ` — ${it.assetLabel.split(" · ")[0]}` : ""}`,
          });
        }
      }
      if (it.status === "incomplete") {
        incomplete.push({
          reqId: req.id,
          reason: `DT 답변 미완료${it.assetLabel ? ` — ${it.assetLabel.split(" · ")[0]}` : ""}`,
        });
      }
    }

    if (iterations.length > 0) {
      blocks.push({ req, iterations, aggregateStatus });
    } else if (req.iterateOver) {
      // No matching assets for this requirement — still counted as a single N/A
      // (the requirement is effectively not applicable to this product because
      // no qualifying assets exist).
      stats.total++;
      stats.na++;
    }
  }

  const assets = parsedAssets
    .filter((a) => assetsUsed.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      description: a.description,
    }));

  return { standard, blocks, assets, stats, incomplete };
}

function collectAnswers(
  dtAnswers: Array<{ requirementId: string; assetId: string | null; nodeId: string; answer: string }>,
  reqId: string,
  assetId: string | null,
): Record<string, NodeAnswer> {
  const out: Record<string, NodeAnswer> = {};
  for (const d of dtAnswers) {
    if (d.requirementId === reqId && (d.assetId ?? null) === assetId) {
      if (d.answer === "yes" || d.answer === "no" || d.answer === "na") {
        out[d.nodeId] = d.answer;
      }
    }
  }
  return out;
}

function buildIter({
  req,
  assetId,
  assetLabel,
  assetKind,
  answers,
  dtAnswers,
  evidenceMap,
  assessmentMap,
  assessTypes,
}: {
  req: DTRequirement;
  assetId: string | null;
  assetLabel: string | null;
  assetKind: string | null;
  answers: Record<string, NodeAnswer>;
  dtAnswers: Array<{
    requirementId: string;
    assetId: string | null;
    nodeId: string;
    notes: string | null;
  }>;
  evidenceMap: Map<string, string>;
  assessmentMap: Map<string, { testMethod: string; testResult: string; verdict: VerdictValue }>;
  assessTypes: AssessmentType[];
}): IterationBlock {
  if (Object.keys(answers).length === 0) {
    // No DT answers yet
    return emptyIter(assetId, assetLabel, assetKind, "incomplete", "");
  }

  const walk = walkTree(req, answers);
  const status: IterationStatus =
    walk.kind === "question" ? "incomplete" : (walk.outcome as IterationStatus);
  const pathSummary = buildPathSummary(walk);

  // Evidence (structured)
  const evidenceFields: Array<{ field: EvidenceField; value: string }> = [];
  if (req.evidenceFields) {
    for (const f of req.evidenceFields) {
      if (
        f.scope === "per_asset" &&
        f.appliesToKinds &&
        (assetKind === null || !f.appliesToKinds.includes(assetKind as never))
      ) {
        continue;
      }
      if (f.dependsOnAnswer) {
        if (answers[f.dependsOnAnswer.nodeId] !== f.dependsOnAnswer.answer) continue;
      }
      const key = `${req.id}::${assetId ?? "__global__"}::${f.id}`;
      evidenceFields.push({ field: f, value: evidenceMap.get(key) ?? "" });
    }
  }

  // Legacy notes for reqs without evidenceFields — YES answers only
  const legacyNotes: IterationBlock["legacyNotes"] = [];
  if (!req.evidenceFields) {
    const pathSteps = walk.path.filter((s) => s.answer === "yes");
    for (const step of pathSteps) {
      const node = req.nodes[step.nodeId];
      const noteRec = dtAnswers.find(
        (d) =>
          d.requirementId === req.id &&
          (d.assetId ?? null) === assetId &&
          d.nodeId === step.nodeId,
      );
      legacyNotes.push({
        nodeId: step.nodeId,
        prompt_ko: node.text_ko,
        notes: noteRec?.notes ?? "",
        answer: step.answer,
      });
    }
  }

  // Assessments (only for non-NA outcomes)
  const assessments: IterationBlock["assessments"] = [];
  if (status === "pass" || status === "fail") {
    for (const t of assessTypes) {
      const key = `${req.id}::${assetId ?? "__global__"}::${t}`;
      const rec = assessmentMap.get(key);
      assessments.push({
        type: t,
        testMethod: rec?.testMethod ?? "",
        testResult: rec?.testResult ?? "",
        verdict: rec?.verdict ?? null,
      });
    }
  }

  return {
    assetId,
    assetLabel,
    assetKind,
    status,
    pathSummary,
    evidenceFields,
    legacyNotes,
    assessments,
  };
}

function emptyIter(
  assetId: string | null,
  assetLabel: string | null,
  assetKind: string | null,
  status: IterationStatus,
  pathSummary: string,
  autoNAReason?: string,
): IterationBlock {
  return {
    assetId,
    assetLabel,
    assetKind,
    status,
    pathSummary,
    autoNAReason,
    evidenceFields: [],
    legacyNotes: [],
    assessments: [],
  };
}

function safeJson(s: string): Record<string, string> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    return {};
  } catch {
    return {};
  }
}
