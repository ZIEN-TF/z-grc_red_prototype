"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { aiFillEvidenceAll } from "@/app/ai-actions";

export function AIFillEvidenceButton({
  projectId,
  hasAttachments,
  hasReviewedFields,
  disabled,
}: {
  projectId: string;
  hasAttachments: boolean;
  hasReviewedFields: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!hasAttachments) {
      toast.error("AI가 참고할 첨부 파일이 없습니다.");
      return;
    }
    const ok = confirm(
      hasReviewedFields
        ? "검수 완료된 필드는 그대로 두고, 미검수·미작성 증빙 필드를 AI가 모두 채웁니다.\n\n수십 번의 GPT 호출이 발생해 1~3분 정도 걸릴 수 있고 비용이 발생합니다. 계속하시겠습니까?"
        : "DT 답변·자산 메타데이터 기반으로 모든 증빙 필드를 AI가 채웁니다.\n\n수십 번의 GPT 호출이 발생해 1~3분 정도 걸릴 수 있고 비용이 발생합니다. 계속하시겠습니까?",
    );
    if (!ok) return;

    startTransition(async () => {
      const t = toast.loading("AI가 증빙 정보를 채우는 중… 1~3분 소요됩니다.");
      try {
        const r = await aiFillEvidenceAll(projectId);
        toast.dismiss(t);
        const summary = `${r.reqsProcessed}개 요구사항 · ${r.totalSaved}개 필드 채움`;
        if (r.errors.length > 0) {
          toast.warning(`${summary} (오류 ${r.errors.length}개 — 콘솔 확인)`);
          console.warn("Evidence AI fill errors:", r.errors);
        } else {
          toast.success(summary);
        }
        router.refresh();
      } catch (err) {
        toast.dismiss(t);
        const msg = err instanceof Error ? err.message : "AI 호출 실패";
        toast.error(msg);
        console.error(err);
      }
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled || pending || !hasAttachments}
    >
      {pending ? (
        <Loader2 className="mr-1 size-4 animate-spin" />
      ) : (
        <Sparkles className="mr-1 size-4" />
      )}
      AI로 증빙 전체 자동 채우기
    </Button>
  );
}
