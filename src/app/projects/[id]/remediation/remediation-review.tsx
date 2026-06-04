"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveDTRemediationResponse } from "@/app/workflow-actions";

export type RemediationItem = {
  id: string;
  requirementId: string;
  requirementTitle: string;
  assetName: string;
  remediationText: string;
  actionStatus: string;
  customerNote: string;
  responded: boolean;
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "done", label: "조치 완료" },
  { value: "in_progress", label: "조치 중" },
  { value: "not_done", label: "미조치" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "미응답",
  done: "조치 완료",
  in_progress: "조치 중",
  not_done: "미조치",
};

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "done"
      ? "bg-primary/10 text-primary"
      : status === "in_progress"
        ? "bg-amber-500/10 text-amber-600"
        : status === "not_done"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${color}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function RemediationCard({
  item,
  editable,
}: {
  item: RemediationItem;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(item.actionStatus);
  const [note, setNote] = useState(item.customerNote);

  function onSave() {
    if (status === "pending") {
      toast.error("조치 현황을 선택해 주세요.");
      return;
    }
    startTransition(async () => {
      try {
        await saveDTRemediationResponse({
          remediationId: item.id,
          actionStatus: status,
          customerNote: note,
        });
        toast.success("조치 현황이 저장되었습니다.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span className="text-sm font-semibold">
              {item.requirementId} · {item.requirementTitle}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">대상: {item.assetName}</p>
        </div>
        <StatusBadge status={item.actionStatus} />
      </div>

      <div className="mt-3 rounded-md bg-muted/50 p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">조치 방안</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.remediationText}</p>
      </div>

      {editable ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <Button
                key={o.value}
                type="button"
                size="sm"
                variant={status === o.value ? "default" : "outline"}
                onClick={() => setStatus(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="조치 내용 또는 사유를 입력하세요."
            rows={2}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={pending} onClick={onSave}>
              저장
            </Button>
          </div>
        </div>
      ) : (
        item.customerNote && (
          <div className="mt-3 border-t pt-2">
            <p className="mb-0.5 text-xs font-medium text-muted-foreground">고객 응답</p>
            <p className="whitespace-pre-wrap text-sm">{item.customerNote}</p>
          </div>
        )
      )}
    </div>
  );
}

export function RemediationReview({
  items,
  editable,
}: {
  items: RemediationItem[];
  editable: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          부적합(FAIL)으로 판정된 항목이 없습니다. 조치가 필요한 사항이 없습니다.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <RemediationCard key={it.id} item={it} editable={editable} />
      ))}
    </div>
  );
}
