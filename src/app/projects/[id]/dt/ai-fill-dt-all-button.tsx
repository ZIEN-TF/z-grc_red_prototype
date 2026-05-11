"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { aiFillDTAll } from "@/app/ai-actions";

export function AIFillDTAllButton({
  projectId,
  hasAttachments,
  hasReviewedAnswers,
  disabled,
}: {
  projectId: string;
  hasAttachments: boolean;
  hasReviewedAnswers: boolean;
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
      hasReviewedAnswers
        ? "이미 검수 완료된 답변은 그대로 두고, ACM·인증자 인스턴스(없는 경우만)와 미검수·미작성 DT 항목을 AI가 한 번에 채웁니다.\n\n수십 번의 GPT 호출이 발생해 1~2분 정도 걸릴 수 있고 비용이 발생합니다. 계속하시겠습니까?"
        : "ACM·인증자 인스턴스를 자동 추가하고 모든 DT 요구사항을 AI가 답변합니다.\n\n수십 번의 GPT 호출이 발생해 1~2분 정도 걸릴 수 있고 비용이 발생합니다. 계속하시겠습니까?",
    );
    if (!ok) return;

    startTransition(async () => {
      const t = toast.loading("AI가 DT 평가를 채우는 중… 1~2분 소요될 수 있습니다.");
      try {
        const r = await aiFillDTAll(projectId);
        toast.dismiss(t);
        const summary = [
          r.acmsCreated > 0 && `ACM ${r.acmsCreated}개 추가`,
          r.authsCreated > 0 && `인증자 ${r.authsCreated}개 추가`,
          r.reqsProcessed > 0 && `${r.reqsProcessed}개 요구사항 채움`,
          r.totalSaved > 0 && `총 ${r.totalSaved}개 답변`,
        ]
          .filter(Boolean)
          .join(" · ");
        if (r.errors.length > 0) {
          toast.warning(
            `${summary || "완료"}. 단 ${r.errors.length}개 요구사항에서 오류 — 콘솔 확인.`,
          );
          console.warn("DT AI fill errors:", r.errors);
        } else {
          toast.success(summary || "완료");
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
      AI로 DT 전체 자동 채우기
    </Button>
  );
}
