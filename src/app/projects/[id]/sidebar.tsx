"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  FileCheck2,
  Package,
  GitBranch,
  CircleDot,
  CheckCircle2,
  Circle,
  FileText,
  Microscope,
  Paperclip,
  FileBarChart,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  label_ko: string;
  label_en: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  indent?: boolean;
  // Which status keys, if any, mark this step complete.
  completeWhen?: "screeningComplete" | "hasAssets" | "hasDTAnswers";
  // If true, only visible to consultant role.
  consultantOnly?: boolean;
};

const STEPS: Step[] = [
  {
    id: "attachments",
    label_ko: "첨부 파일",
    label_en: "Attachments",
    path: "/attachments",
    icon: Paperclip,
  },
  {
    id: "screening",
    label_ko: "스크리닝",
    label_en: "Screening",
    path: "/screening",
    icon: ClipboardList,
    completeWhen: "screeningComplete",
  },
  {
    id: "result",
    label_ko: "스크리닝 결과",
    label_en: "Result",
    path: "/result",
    icon: FileCheck2,
  },
  {
    id: "assets",
    label_ko: "자산 인벤토리",
    label_en: "Assets",
    path: "/assets",
    icon: Package,
    completeWhen: "hasAssets",
  },
  {
    id: "assets-review",
    label_ko: "자산 검토",
    label_en: "Assets Review",
    path: "/assets/review",
    icon: Circle,
    indent: true,
  },
  {
    id: "dt",
    label_ko: "Decision Tree 평가",
    label_en: "DT Evaluation",
    path: "/dt",
    icon: GitBranch,
    completeWhen: "hasDTAnswers",
  },
  {
    id: "evidence",
    label_ko: "증빙 정보 입력",
    label_en: "Evidence",
    path: "/evidence",
    icon: FileText,
  },
  {
    id: "assessment",
    label_ko: "기능 평가",
    label_en: "Assessment",
    path: "/assessment",
    icon: Microscope,
    consultantOnly: true,
  },
  {
    id: "report",
    label_ko: "최종 리포트",
    label_en: "Final Report",
    path: "/report",
    icon: FileBarChart,
  },
];

export type SidebarProject = {
  id: string;
  name: string;
  manufacturer: string;
  screeningComplete: boolean;
  hasAssets: boolean;
  hasDTAnswers: boolean;
};

export function ProjectSidebar({
  project,
  role,
}: {
  project: SidebarProject;
  role: "customer" | "consultant";
}) {
  const pathname = usePathname();
  const basePath = `/projects/${project.id}`;
  const visibleSteps = STEPS.filter(
    (s) => !s.consultantOnly || role === "consultant",
  );

  return (
    <aside className="hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-6rem)] lg:w-56 lg:shrink-0">
      <div className="rounded-lg border bg-card p-3">
        <Link
          href="/"
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          프로젝트 목록
        </Link>

        <div className="mb-3 border-b pb-3">
          <h3 className="truncate text-sm font-medium" title={project.name}>
            {project.name}
          </h3>
          <p
            className="truncate text-[11px] text-muted-foreground"
            title={project.manufacturer}
          >
            {project.manufacturer}
          </p>
        </div>

        <nav className="space-y-0.5">
          {visibleSteps.map((step) => {
            const fullPath = basePath + step.path;
            // Active: exact match OR any deeper path under this step, but the
            // sub-review paths should not also highlight their parent.
            const isReview = step.path.endsWith("/review");
            const active = isReview
              ? pathname === fullPath
              : pathname === fullPath ||
                (pathname.startsWith(fullPath + "/") &&
                  // exclude /review from highlighting the parent
                  !pathname.startsWith(fullPath + "/review"));
            const Icon = step.icon;
            const complete =
              step.completeWhen !== undefined && project[step.completeWhen];

            return (
              <Link
                key={step.id}
                href={fullPath}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                  step.indent && "ml-5",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {complete && !active ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-primary/70" />
                ) : active ? (
                  <CircleDot className="size-3.5 shrink-0" />
                ) : (
                  <Icon className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{step.label_ko}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 border-t pt-3">
          <p className="text-[10px] leading-snug text-muted-foreground">
            모든 단계는 자유롭게 오갈 수 있습니다. 이미 입력한 내용은 유지됩니다.
          </p>
        </div>
      </div>
    </aside>
  );
}
