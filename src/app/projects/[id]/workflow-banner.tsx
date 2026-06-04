"use client";

// Collaboration-workflow banner shown on every project page. Renders the
// current stage, whose turn it is, and confirm/reject controls when it's the
// viewer's turn. NOTE: customer-facing copy never mentions AI — to a customer
// the work simply "검토 자료" being prepared.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { confirmStage, rejectStage } from "@/app/workflow-actions";
import {
  type Phase,
  type WorkflowRole,
  PHASE_ACTOR,
  PHASE_LABEL_KO,
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

// Status line when it is NOT the viewer's turn. Keyed by [phase][viewerRole].
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
  // The other side's turn.
  return actor === "consultant"
    ? "컨설턴트 검토를 기다리고 있습니다."
    : "고객 확인을 기다리고 있습니다.";
}

export function WorkflowBanner({
  projectId,
  phase,
  role,
}: {
  projectId: string;
  phase: Phase;
  role: WorkflowRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const canConfirm = confirmTransition(phase, role) !== null;
  const canReject = rejectTransition(phase, role) !== null;
  const isRunning = PHASE_ACTOR[phase] === "ai";

  function onConfirm() {
    startTransition(async () => {
      try {
        await confirmStage(projectId);
        toast.success("확인이 완료되었습니다.");
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
    startTransition(async () => {
      try {
        await rejectStage(projectId, reason.trim());
        toast.success("반려되었습니다.");
        setRejecting(false);
        setReason("");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.");
      }
    });
  }

  const isMyTurn = canConfirm || canReject;

  return (
    <div
      className={`mb-5 rounded-lg border px-4 py-3 ${
        isMyTurn ? "border-primary/40 bg-primary/5" : "border-border bg-muted/40"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : isMyTurn ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <Clock className="size-4 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-semibold">
              현재 단계: {PHASE_LABEL_KO[phase]}
            </p>
            {!isMyTurn && (
              <p className="text-xs text-muted-foreground">{statusText(phase, role)}</p>
            )}
          </div>
        </div>

        {isMyTurn && (
          <div className="flex items-center gap-2">
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
              <Button size="sm" disabled={pending} onClick={onConfirm}>
                <CheckCircle2 className="size-3.5" />
                {CONFIRM_LABEL[phase] ?? "확인 완료"}
              </Button>
            )}
          </div>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 space-y-2 border-t pt-3">
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
