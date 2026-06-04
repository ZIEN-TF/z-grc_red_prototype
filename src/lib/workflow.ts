// Collaboration workflow state machine. Pure data + helpers (no DB/IO), so it
// can be imported by server actions and the background pipeline runner alike.
//
// Flow: a customer registers + screens, then AI fills are gated by alternating
// customer/consultant confirmations. Each confirm/reject transition advances
// `Project.phase` and (optionally) starts the next AI stage or notifies the
// other side.

export type Phase =
  | "INTAKE" // customer: registration + attachments + screening
  | "ASSETS_RUNNING" // AI: identifying assets
  | "ASSETS_CUSTOMER" // customer: review/confirm assets
  | "ASSETS_CONSULTANT" // consultant: review/confirm assets
  | "DT_RUNNING" // AI: DT + evidence + fail remediation
  | "DT_CUSTOMER" // customer: review/confirm DT + answer remediations
  | "DT_CONSULTANT" // consultant: review/confirm DT
  | "ASSESSMENT_RUNNING" // AI: functional-assessment testMethod
  | "ASSESSMENT" // consultant: perform assessment + finalize
  | "REPORT_CUSTOMER" // customer: confirm final report
  | "DONE";

export type WorkflowRole = "customer" | "consultant";
export type GatedAiStage = "assets" | "dt" | "assessment";

export const PHASE_ORDER: Phase[] = [
  "INTAKE",
  "ASSETS_RUNNING",
  "ASSETS_CUSTOMER",
  "ASSETS_CONSULTANT",
  "DT_RUNNING",
  "DT_CUSTOMER",
  "DT_CONSULTANT",
  "ASSESSMENT_RUNNING",
  "ASSESSMENT",
  "REPORT_CUSTOMER",
  "DONE",
];

// Korean label for each phase (UI banners / progress).
export const PHASE_LABEL_KO: Record<Phase, string> = {
  INTAKE: "기초 정보 입력",
  ASSETS_RUNNING: "자산 분석 중",
  ASSETS_CUSTOMER: "자산 고객 확인",
  ASSETS_CONSULTANT: "자산 컨설턴트 검토",
  DT_RUNNING: "DT·증빙 분석 중",
  DT_CUSTOMER: "DT·조치방안 고객 확인",
  DT_CONSULTANT: "DT 컨설턴트 검토",
  ASSESSMENT_RUNNING: "기능평가 준비 중",
  ASSESSMENT: "기능평가 수행",
  REPORT_CUSTOMER: "최종 리포트 고객 확인",
  DONE: "완료",
};

// Who is expected to act in each phase. "ai" = a background fill is running;
// "none" = terminal.
export const PHASE_ACTOR: Record<Phase, WorkflowRole | "ai" | "none"> = {
  INTAKE: "customer",
  ASSETS_RUNNING: "ai",
  ASSETS_CUSTOMER: "customer",
  ASSETS_CONSULTANT: "consultant",
  DT_RUNNING: "ai",
  DT_CUSTOMER: "customer",
  DT_CONSULTANT: "consultant",
  ASSESSMENT_RUNNING: "ai",
  ASSESSMENT: "consultant",
  REPORT_CUSTOMER: "customer",
  DONE: "none",
};

export function isActorTurn(phase: Phase, role: WorkflowRole): boolean {
  return PHASE_ACTOR[phase] === role;
}

export type Transition = {
  next: Phase;
  startAi?: GatedAiStage; // start this AI stage after the transition
  notify?: WorkflowRole; // notify this side now (used when no AI stage gates it)
  notifyType: string;
};

// What happens when the actor for `phase` CONFIRMS. Returns null if `role` is
// not the actor for that phase (i.e. not allowed to confirm now).
export function confirmTransition(phase: Phase, role: WorkflowRole): Transition | null {
  switch (phase) {
    case "ASSETS_CUSTOMER":
      return role === "customer"
        ? { next: "ASSETS_CONSULTANT", notify: "consultant", notifyType: "ASSETS_CUSTOMER_CONFIRMED" }
        : null;
    case "ASSETS_CONSULTANT":
      return role === "consultant"
        ? { next: "DT_RUNNING", startAi: "dt", notifyType: "ASSETS_CONSULTANT_CONFIRMED" }
        : null;
    case "DT_CUSTOMER":
      return role === "customer"
        ? { next: "DT_CONSULTANT", notify: "consultant", notifyType: "DT_CUSTOMER_CONFIRMED" }
        : null;
    case "DT_CONSULTANT":
      return role === "consultant"
        ? { next: "ASSESSMENT_RUNNING", startAi: "assessment", notifyType: "DT_CONSULTANT_CONFIRMED" }
        : null;
    case "REPORT_CUSTOMER":
      return role === "customer"
        ? { next: "DONE", notify: "consultant", notifyType: "REPORT_CUSTOMER_CONFIRMED" }
        : null;
    default:
      return null;
  }
}

// What happens when the actor for `phase` REJECTS (sends it back). Customer
// rejects of AI output re-run that AI stage; consultant rejects bounce back to
// the customer.
export function rejectTransition(phase: Phase, role: WorkflowRole): Transition | null {
  switch (phase) {
    case "ASSETS_CUSTOMER":
      return role === "customer"
        ? { next: "ASSETS_RUNNING", startAi: "assets", notifyType: "ASSETS_CUSTOMER_REJECTED" }
        : null;
    case "ASSETS_CONSULTANT":
      return role === "consultant"
        ? { next: "ASSETS_CUSTOMER", notify: "customer", notifyType: "ASSETS_CONSULTANT_REJECTED" }
        : null;
    case "DT_CUSTOMER":
      return role === "customer"
        ? { next: "DT_RUNNING", startAi: "dt", notifyType: "DT_CUSTOMER_REJECTED" }
        : null;
    case "DT_CONSULTANT":
      return role === "consultant"
        ? { next: "DT_CUSTOMER", notify: "customer", notifyType: "DT_CONSULTANT_REJECTED" }
        : null;
    case "REPORT_CUSTOMER":
      return role === "customer"
        ? { next: "ASSESSMENT", notify: "consultant", notifyType: "REPORT_CUSTOMER_REJECTED" }
        : null;
    default:
      return null;
  }
}

// After an AI gated stage finishes, the phase it advances to + who to notify.
// Applied only when the project is still at the matching *_RUNNING phase.
export const AI_DONE_TRANSITION: Record<
  GatedAiStage,
  { from: Phase; next: Phase; notify: WorkflowRole; notifyType: string }
> = {
  assets: { from: "ASSETS_RUNNING", next: "ASSETS_CUSTOMER", notify: "customer", notifyType: "ASSETS_READY" },
  dt: { from: "DT_RUNNING", next: "DT_CUSTOMER", notify: "customer", notifyType: "DT_READY" },
  assessment: { from: "ASSESSMENT_RUNNING", next: "ASSESSMENT", notify: "consultant", notifyType: "ASSESSMENT_READY" },
};

// Role-aware project status for the home project list. Customer-facing copy
// never mentions AI (a "running" stage reads as "준비 중"). `isMyTurn` drives
// the highlight + top-sort; `ctaPath` is the suffix after /projects/{id}.
export type ProjectStatus = {
  label: string; // badge text
  detail: string; // line under the progress bar
  isMyTurn: boolean; // needs this role's action now
  tone: "default" | "secondary" | "outline" | "success" | "warn";
  ctaPath: string; // "" = overview, "/assets", "/remediation", "/report", …
  ctaLabel: string;
};

export function projectStatusFor(phaseRaw: string, role: WorkflowRole): ProjectStatus {
  const phase = (PHASE_ORDER.includes(phaseRaw as Phase) ? phaseRaw : "INTAKE") as Phase;
  const isMyTurn = PHASE_ACTOR[phase] === role;
  const tone: ProjectStatus["tone"] =
    phase === "DONE" ? "success" : isMyTurn ? "warn" : "secondary";

  // [label, detail, ctaPath, ctaLabel] per phase, per role.
  const C: Record<Phase, [string, string, string, string]> = {
    INTAKE: ["기초 정보 입력 중", "첨부파일과 스크리닝을 완료해 주세요.", "/screening", "스크리닝 진행"],
    ASSETS_RUNNING: ["자산 준비 중", "자산 목록을 준비하고 있습니다.", "", "현황 보기"],
    ASSETS_CUSTOMER: ["자산 확인 필요", "자산 목록을 확인하고 확정해 주세요.", "/assets", "자산 확인하기"],
    ASSETS_CONSULTANT: ["컨설턴트 검토 중", "컨설턴트 검토를 기다리고 있습니다.", "", "현황 보기"],
    DT_RUNNING: ["평가 준비 중", "평가 자료를 준비하고 있습니다.", "", "현황 보기"],
    DT_CUSTOMER: ["평가·조치 확인 필요", "평가 결과와 조치 방안을 확인해 주세요.", "/remediation", "확인하기"],
    DT_CONSULTANT: ["컨설턴트 검토 중", "컨설턴트 검토를 기다리고 있습니다.", "", "현황 보기"],
    ASSESSMENT_RUNNING: ["평가 준비 중", "최종 평가를 준비하고 있습니다.", "", "현황 보기"],
    ASSESSMENT: ["컨설턴트 평가 중", "컨설턴트가 기능 평가를 진행 중입니다.", "", "현황 보기"],
    REPORT_CUSTOMER: ["최종 리포트 확인 필요", "최종 리포트를 확인해 주세요.", "/report", "리포트 확인"],
    DONE: ["완료", "프로젝트가 완료되었습니다.", "/report", "리포트 보기"],
  };
  const K: Record<Phase, [string, string, string, string]> = {
    INTAKE: ["고객 입력 대기", "고객이 기초 정보를 입력하고 있습니다.", "", "현황 보기"],
    ASSETS_RUNNING: ["자산 분석 중", "AI가 자산을 분석하고 있습니다.", "/result", "현황 보기"],
    ASSETS_CUSTOMER: ["고객 자산 확인 대기", "고객의 자산 확인을 기다리고 있습니다.", "", "현황 보기"],
    ASSETS_CONSULTANT: ["자산 검토 필요", "자산 목록을 검토하고 승인해 주세요.", "/assets", "자산 검토"],
    DT_RUNNING: ["DT 분석 중", "AI가 DT·증빙을 분석하고 있습니다.", "/result", "현황 보기"],
    DT_CUSTOMER: ["고객 확인 대기", "고객의 확인을 기다리고 있습니다.", "", "현황 보기"],
    DT_CONSULTANT: ["DT 검토 필요", "DT 평가를 검토하고 승인해 주세요.", "/dt", "DT 검토"],
    ASSESSMENT_RUNNING: ["기능평가 준비 중", "AI가 평가 방법을 준비하고 있습니다.", "/result", "현황 보기"],
    ASSESSMENT: ["기능평가 수행 필요", "기능 평가를 수행하고 리포트를 확정해 주세요.", "/assessment", "기능평가 수행"],
    REPORT_CUSTOMER: ["고객 최종 확인 대기", "고객의 최종 확인을 기다리고 있습니다.", "/report", "현황 보기"],
    DONE: ["완료", "프로젝트가 완료되었습니다.", "/report", "리포트 보기"],
  };
  const [label, detail, ctaPath, ctaLabel] = (role === "consultant" ? K : C)[phase];
  return { label, detail, isMyTurn, tone, ctaPath, ctaLabel };
}

// Notification copy (Korean). NOTE: never reveals that content is AI-authored —
// to a customer the work always reads as "검토 자료가 준비되었습니다".
export function notificationCopy(type: string, projectName: string): { title: string; body: string } {
  const p = projectName;
  switch (type) {
    case "ASSETS_READY":
      return { title: `[${p}] 자산 목록 검토 요청`, body: "자산 목록이 준비되었습니다. 내용을 확인하고 확정해 주세요." };
    case "ASSETS_CUSTOMER_CONFIRMED":
      return { title: `[${p}] 고객이 자산을 확인했습니다`, body: "자산 목록에 대한 컨설턴트 검토를 진행해 주세요." };
    case "ASSETS_CONSULTANT_REJECTED":
      return { title: `[${p}] 자산 검토 반려`, body: "컨설턴트가 자산 단계를 반려했습니다. 내용을 보완해 주세요." };
    case "DT_READY":
      return { title: `[${p}] DT·조치방안 검토 요청`, body: "평가 결과와 조치 방안이 준비되었습니다. 확인하고 조치 현황을 입력해 주세요." };
    case "DT_CUSTOMER_CONFIRMED":
      return { title: `[${p}] 고객이 DT를 확인했습니다`, body: "DT 평가에 대한 컨설턴트 검토를 진행해 주세요." };
    case "DT_CONSULTANT_REJECTED":
      return { title: `[${p}] DT 검토 반려`, body: "컨설턴트가 DT 단계를 반려했습니다. 내용을 보완해 주세요." };
    case "ASSESSMENT_READY":
      return { title: `[${p}] 기능 평가 수행 요청`, body: "기능 평가 준비가 완료되었습니다. 평가를 수행해 주세요." };
    case "REPORT_FINALIZED":
      return { title: `[${p}] 최종 리포트 확인 요청`, body: "최종 리포트가 완성되었습니다. 내용을 확인해 주세요." };
    case "REPORT_CUSTOMER_CONFIRMED":
      return { title: `[${p}] 고객이 최종 리포트를 확인했습니다`, body: "프로젝트가 완료 처리되었습니다." };
    case "REPORT_CUSTOMER_REJECTED":
      return { title: `[${p}] 최종 리포트 반려`, body: "고객이 최종 리포트를 반려했습니다. 내용을 재검토해 주세요." };
    default:
      return { title: `[${p}] 알림`, body: "" };
  }
}
