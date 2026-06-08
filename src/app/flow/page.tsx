import Link from "next/link";
import {
  ClipboardList,
  Bot,
  CheckCircle2,
  ShieldCheck,
  GitBranch,
  Microscope,
  FileBarChart,
  Bell,
  Undo2,
  User,
  Sparkles,
  ArrowLeft,
} from "lucide-react";

export const metadata = {
  title: "Flow — Z-GRC 진행 흐름",
};

type Actor = "customer" | "ai" | "consultant";

const ACTOR_META: Record<
  Actor,
  { label: string; sub: string; icon: React.ComponentType<{ className?: string }>; lane: string; card: string; badge: string; text: string }
> = {
  customer: {
    label: "고객",
    sub: "Customer",
    icon: User,
    lane: "bg-blue-500/5",
    card: "border-blue-500/40 bg-blue-50 dark:bg-blue-950/30",
    badge: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-300",
  },
  ai: {
    label: "AI",
    sub: "자동 분석",
    icon: Sparkles,
    lane: "bg-violet-500/5",
    card: "border-violet-500/40 bg-violet-50 dark:bg-violet-950/30",
    badge: "bg-violet-500",
    text: "text-violet-700 dark:text-violet-300",
  },
  consultant: {
    label: "컨설턴트",
    sub: "Consultant",
    icon: ShieldCheck,
    lane: "bg-emerald-500/5",
    card: "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30",
    badge: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

const LANES: Actor[] = ["customer", "ai", "consultant"];

type Step = {
  n: number;
  actor: Actor;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
};

const STEPS: Step[] = [
  { n: 1, actor: "customer", title: "프로젝트 등록 · 스크리닝", desc: "제품 정보·펌웨어/문서 첨부, 스크리닝 작성·제출", icon: ClipboardList },
  { n: 2, actor: "ai", title: "자산 자동 분석", desc: "펌웨어·문서를 분석해 보안 자산 목록 생성", icon: Bot },
  { n: 3, actor: "customer", title: "자산 목록 확인", desc: "생성된 자산을 검토하고 확정", icon: CheckCircle2 },
  { n: 4, actor: "consultant", title: "자산 검토 · 승인", desc: "자산 목록을 검토하고 다음 단계로 승인", icon: ShieldCheck },
  { n: 5, actor: "ai", title: "DT 평가 · 증빙 · 조치방안", desc: "요구사항별 Decision Tree 평가, 증빙, 부적합 조치방안 작성", icon: GitBranch },
  { n: 6, actor: "customer", title: "평가 · 조치현황 확인", desc: "평가 결과와 조치방안을 확인하고 조치현황 입력", icon: CheckCircle2 },
  { n: 7, actor: "consultant", title: "DT 검토 · 승인", desc: "평가 내용을 검토하고 승인", icon: ShieldCheck },
  { n: 8, actor: "ai", title: "기능평가 테스트방법 작성", desc: "요구사항별 테스트 방법(절차) 초안 작성", icon: Bot },
  { n: 9, actor: "consultant", title: "기능평가 수행 · 리포트 확정", desc: "테스트 결과·판정을 직접 입력하고 최종 리포트 확정", icon: Microscope },
  { n: 10, actor: "customer", title: "최종 리포트 확인", desc: "완성된 최종 리포트를 확인하고 종료", icon: FileBarChart },
];

function LaneHeader({ actor }: { actor: Actor }) {
  const m = ACTOR_META[actor];
  const Icon = m.icon;
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border bg-card py-2">
      <span className={`flex size-6 items-center justify-center rounded-full ${m.badge} text-white`}>
        <Icon className="size-3.5" />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold">{m.label}</p>
        <p className="text-[10px] text-muted-foreground">{m.sub}</p>
      </div>
    </div>
  );
}

const COL_INDEX: Record<Actor, number> = { customer: 0, ai: 1, consultant: 2 };
const COL_X = ["16.6667%", "50%", "83.3333%"];
const ROW_H = 104; // px — fixed so the SVG arrow endpoints stay aligned
const CARD_HALF = 36; // px — half the (fixed) card height

function StepCard({ step }: { step: Step }) {
  const m = ACTOR_META[step.actor];
  const Icon = step.icon;
  return (
    <div className={`flex h-[72px] w-full flex-col justify-center overflow-hidden rounded-lg border px-3 py-2 shadow-sm ${m.card}`}>
      <div className="flex items-center gap-2">
        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${m.badge} text-[10px] font-bold text-white`}>
          {step.n}
        </span>
        <Icon className={`size-4 shrink-0 ${m.text}`} />
        <p className="truncate text-sm font-semibold leading-tight">{step.title}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
        {step.desc}
      </p>
    </div>
  );
}

export default function FlowPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          홈으로
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          진행 흐름
          <span className="ml-2 text-base font-medium text-muted-foreground">/ End-to-End Flow</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          프로젝트 등록부터 최종 리포트까지 — <span className="font-medium text-foreground">고객 · AI · 컨설턴트</span> 세
          주체가 단계별로 주고받으며 진행합니다.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3 text-xs">
        {LANES.map((a) => {
          const m = ACTOR_META[a];
          const Icon = m.icon;
          return (
            <span key={a} className="flex items-center gap-1.5">
              <span className={`flex size-4 items-center justify-center rounded-full ${m.badge} text-white`}>
                <Icon className="size-2.5" />
              </span>
              <span className="font-medium">{m.label}</span>
            </span>
          );
        })}
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="flex items-center gap-1 text-muted-foreground">
          <Bell className="size-3.5" /> 단계 전환 시 상대에게 알림
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Undo2 className="size-3.5" /> 각 확인 단계는 반려(되돌리기) 가능
        </span>
      </div>

      {/* Swimlane */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Lane headers */}
          <div className="sticky top-0 z-10 grid grid-cols-3 gap-3 bg-background/80 pb-2 backdrop-blur">
            {LANES.map((a) => (
              <LaneHeader key={a} actor={a} />
            ))}
          </div>

          {/* Fixed-height rows (one per step) with an SVG arrow overlay that
              connects each step to the next, crossing lanes to show the flow. */}
          <div className="relative" style={{ height: STEPS.length * ROW_H }}>
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  id="flow-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="5.5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
                </marker>
              </defs>
              {STEPS.slice(0, -1).map((s, i) => {
                const from = STEPS[i];
                const to = STEPS[i + 1];
                const x1 = COL_X[COL_INDEX[from.actor]];
                const x2 = COL_X[COL_INDEX[to.actor]];
                const y1 = i * ROW_H + ROW_H / 2 + CARD_HALF;
                const y2 = (i + 1) * ROW_H + ROW_H / 2 - CARD_HALF;
                return (
                  <line
                    key={s.n}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    markerEnd="url(#flow-arrow)"
                  />
                );
              })}
            </svg>

            <div className="relative z-10">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className="grid grid-cols-3 items-center gap-3"
                  style={{ height: ROW_H }}
                >
                  {LANES.map((lane) => (
                    <div key={lane} className="flex items-center justify-center">
                      {s.actor === lane ? <StepCard step={s} /> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Completion */}
          <div className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 py-3 text-sm font-semibold text-primary">
            <FileBarChart className="size-4" />
            최종 리포트 발행 · 완료
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        ※ AI가 작성한 초안은 고객에게 노출되지 않으며, 모든 핸드오프 단계에서 인앱 알림이 전달됩니다.
      </p>
    </div>
  );
}
