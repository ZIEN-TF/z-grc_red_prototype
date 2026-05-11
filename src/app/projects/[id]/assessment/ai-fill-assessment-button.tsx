"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { aiFillAssessmentAll } from "@/app/ai-actions";

export function AIFillAssessmentButton({
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
        ? "검수 완료된 평가는 그대로 두고, 미검수·미작성 testMethod를 AI가 모두 채웁니다.\n\n수십 번의 GPT 호출이 발생해 1~2분 정도 걸릴 수 있고 비용이 발생합니다. 계속하시겠습니까?"
        : "DT 결과(PASS/FAIL) 항목별로 testMethod 초안을 AI가 작성합니다. testResult·verdict는 컨설턴트 직접 입력으로 남습니다.\n\n수십 번의 GPT 호출이 발생해 1~2분 정도 걸릴 수 있고 비용이 발생합니다. 계속하시겠습니까?",
    );
    if (!ok) return;

    startTransition(async () => {
      const t = toast.loading("AI가 testMethod를 작성하는 중… 1~2분 소요됩니다.");
      try {
        const r = await aiFillAssessmentAll(projectId);
        toast.dismiss(t);
        const summary = `${r.reqsProcessed}개 요구사항 · ${r.totalSaved}개 testMethod 작성`;
        if (r.errors.length > 0) {
          toast.warning(`${summary} (오류 ${r.errors.length}개 — 콘솔 확인)`);
          console.warn("Assessment AI fill errors:", r.errors);
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
      AI로 testMethod 전체 자동 채우기
    </Button>
  );
}
