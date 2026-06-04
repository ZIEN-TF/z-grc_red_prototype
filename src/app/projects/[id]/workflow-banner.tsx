"use client";

// Collaboration-workflow banner shown on every project page: a progress
// stepper, the current stage + whose turn it is, and confirm/reject/finalize
// controls when it's the viewer's turn. While waiting on AI or the other party
// it polls for state changes and auto-refreshes. NOTE: customer-facing copy
// never mentions AI — to a customer the work is simply "검토 자료" being prepared.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, RotateCw, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmStage,
  rejectStage,
  retryAiStage,
  getWorkflowState,
} from "@/app/workflow-actions";
import { finalizeProject } from "@/app/actions";
import {
  type Phase,
  type WorkflowRole,
  PHASE_ACTOR,
  PHASE_LABEL_KO,
  MILESTONES,
  phaseMilestoneIndex,
  confirmTransition,
  rejectTransition,
} from "@/lib/workflow";

const CONFIRM_LABEL: Partial<Record<Phase, string>> = {
  ASSETS_CUSTOMER: "자산 확인 완료",
  ASSETS_CONSULTANT: "자산 검토 승인",
  DT_CUSTOMER: "DT·조치 확인 완료",
  DT_CONSULTANT: "DT 검토 승인",
  REPORT_CUSTOMER: "최종 리포트 확인 완료",
};

function statusText(phase: Phase, role: WorkflowRole): string {
  const actor = PHASE_ACTOR[phase];
  if (actor === "ai") {
    return role === "customer"
      ? "검토 자료를 준비하고 있습니다. 잠시만 기다려 주세요."
      : "AI 자동 분석이 진행 중입니다. 완료되면 알림을 보냅니다.";
  }
  if (phase === "ASSESSMENT") {
    return role === "consultant"
      ? "기능 평가를 수행한 뒤 리포트에서 최종 확정하세요."
      : "컨설턴트가 기능 평가를 수행하고 있습니다.";
  }
  if (phase === "INTAKE") {
    return role === "customer"
      ? "기초 정보·첨부파일·스크리닝을 완료해 주세요."
      : "고객이 기초 정보를 입력하고 있습니다.";
  }
  if (phase === "DONE") return "프로젝트가 완료되었습니다.";
  return actor === "consultant"
    ? "컨설턴트 검토를 기다리고 있습니다."
    : "고객 확인을 기다리고 있습니다.";
}

function Stepper({ phase }: { phase: Phase }) {
  const cur = phaseMilestoneIndex(phase);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      {MILESTONES.map((m, i) => (
        <span key={m} className="flex items-center gap-1">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              i < cur
                ? "text-primary"
                : i === cur
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-muted-foreground/60"
            }`}
          >
            {i < cur ? "✓ " : ""}
            {m}
          </span>
          {i < MILESTONES.length - 1 && (
            <span className="text-[10px] text-muted-foreground/40">›</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function WorkflowBanner({
  projectId,
  phase,
  role,
  ownerless = false,
  aiFailed = false,
}: {
  projectId: string;
  phase: Phase;
  role: WorkflowRole;
  // Legacy project with no customer owner — the consultant performs the
  // customer's turns too.
  ownerless?: boolean;
  // The in-progress AI run failed — offer a retry instead of an endless spinner.
  aiFailed?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [finalizing, setFinalizing] = useState(false);

  const actsCustomer = ownerless && role === "consultant";
  const confirmT =
    confirmTransition(phase, role) ??
    (actsCustomer ? confirmTransition(phase, "customer") : null);
  const rejectT =
    rejectTransition(phase, role) ??
    (actsCustomer ? rejectTransition(phase, "customer") : null);

  const canConfirm = !!confirmT;
  const canReject = !!rejectT;
  const canFinalize = phase === "ASSESSMENT" && role === "consultant";
  const isRunning = PHASE_ACTOR[phase] === "ai";
  const rejectRerunsAi = !!rejectT?.startAi;
  const isMyTurn = canConfirm || canReject || canFinalize;

  // Poll while waiting on AI or the other party; refresh when the server's
  // phase / failure state changes (router.refresh, not setState — no cascade).
  useEffect(() => {
    if (isMyTurn && !isRunning) return;
    let active = true;
    const t = setInterval(async () => {
      try {
        const s = await getWorkflowState(projectId);
        if (!active || !s) return;
        if (s.phase !== phase || s.aiFailed !== aiFailed) router.refresh();
      } catch {
        /* ignore */
      }
    }, 10000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [projectId, phase, aiFailed, isMyTurn, isRunning, router]);

  function run(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(ok);
        after?.();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.");
      }
    });
  }

  function onReject() {
    if (!reason.trim()) {
      toast.error("반려 사유를 입력해 주세요.");
      return;
    }
    run(() => rejectStage(projectId, reason.trim()), "반려되었습니다.", () => {
      setRejecting(false);
      setReason("");
    });
  }

  const showRetry = isRunning && aiFailed;

  return (
    <div
      className={`mb-5 rounded-lg border px-4 py-3 ${
        showRetry
          ? "border-destructive/40 bg-destructive/5"
          : isMyTurn
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-muted/40"
      }`}
    >
      <Stepper phase={phase} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {showRetry ? (
            <TriangleAlert className="size-4 text-destructive" />
          ) : isRunning ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : isMyTurn ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <Clock className="size-4 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-semibold">현재 단계: {PHASE_LABEL_KO[phase]}</p>
            {showRetry ? (
              <p className="text-xs text-destructive">
                자동 분석이 실패했습니다. 다시 시도해 주세요.
              </p>
            ) : (
              !isMyTurn && (
                <p className="text-xs text-muted-foreground">{statusText(phase, role)}</p>
              )
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showRetry && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => retryAiStage(projectId), "다시 시도합니다.")}
            >
              <RotateCw className="size-3.5" />
              다시 시도
            </Button>
          )}
          {isMyTurn && !showRetry && (
            <>
              {canReject && !rejecting && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => setRejecting(true)}
                >
                  <XCircle className="size-3.5" />
                  반려
                </Button>
              )}
              {canConfirm && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => confirmStage(projectId), "확인이 완료되었습니다.")}
                >
                  <CheckCircle2 className="size-3.5" />
                  {CONFIRM_LABEL[phase] ?? "확인 완료"}
                </Button>
              )}
              {canFinalize && !finalizing && (
                <Button size="sm" disabled={pending} onClick={() => setFinalizing(true)}>
                  <CheckCircle2 className="size-3.5" />
                  기능 평가 완료
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {finalizing && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-sm">
            기능 평가를 완료하고 고객에게 최종 리포트 확인을 요청합니다. 진행할까요?
            <span className="text-muted-foreground">
              {" "}
              (이후 프로젝트는 확정·잠금되며, 필요 시 다시 열 수 있습니다.)
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setFinalizing(false)}>
              취소
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => finalizeProject({ projectId }), "기능 평가를 완료하고 고객에게 최종 확인을 요청했습니다.", () =>
                  setFinalizing(false),
                )
              }
            >
              완료 및 고객 확인 요청
            </Button>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {rejectRerunsAi && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              반려하면 입력하신 사유를 반영해 자료를 다시 분석합니다. 시간이 걸릴 수 있어요.
            </p>
          )}
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="반려 사유를 입력하세요 (상대방에게 알림으로 전달됩니다)."
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
            >
              취소
            </Button>
            <Button variant="destructive" size="sm" disabled={pending} onClick={onReject}>
              반려 제출
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
