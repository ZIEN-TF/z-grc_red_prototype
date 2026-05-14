"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { aiFillDTInit, aiFillDTRequirement } from "@/app/ai-actions";

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
      const t = toast.loading("AI가 DT 평가를 준비 중…");
      try {
        // Step 1: instance creation + requirement list. One server-action call.
        const init = await aiFillDTInit(projectId);

        const total = init.requirementIds.length;
        setProgress({ done: 0, total });

        let totalSaved = 0;
        let reqsProcessed = 0;
        let reqsSkipped = 0;
        const errors: string[] = [];

        // Step 2: process each requirement in its own server-action call so
        // every individual call stays well under the 100s proxy timeout that
        // Cloudflare (and most reverse proxies) enforce on long requests.
        for (let i = 0; i < init.requirementIds.length; i++) {
          const reqId = init.requirementIds[i];
          toast.loading(
            `AI가 DT 평가를 채우는 중… (${i + 1}/${total}) ${reqId}`,
            { id: t },
          );
          try {
            const r = await aiFillDTRequirement(projectId, reqId);
            if (r.skipped) {
              reqsSkipped++;
            } else {
              totalSaved += r.saved;
              reqsProcessed++;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "AI 호출 실패";
            errors.push(`${reqId}: ${msg}`);
            console.error(`DT AI fill error for ${reqId}:`, err);
          }
          setProgress({ done: i + 1, total });
        }

        toast.dismiss(t);
        const summary = [
          init.acmsCreated > 0 && `ACM ${init.acmsCreated}개 추가`,
          init.authsCreated > 0 && `인증자 ${init.authsCreated}개 추가`,
          reqsProcessed > 0 && `${reqsProcessed}개 요구사항 채움`,
          totalSaved > 0 && `총 ${totalSaved}개 답변`,
        ]
          .filter(Boolean)
          .join(" · ");
        if (errors.length > 0) {
          toast.warning(
            `${summary || "완료"}. 단 ${errors.length}개 요구사항에서 오류 — 콘솔 확인.`,
          );
          console.warn("DT AI fill errors:", errors);
        } else {
          toast.success(summary || "완료");
        }
        setProgress(null);
        router.refresh();
      } catch (err) {
        toast.dismiss(t);
        const msg = err instanceof Error ? err.message : "AI 호출 실패";
        toast.error(msg);
        console.error(err);
        setProgress(null);
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
      {progress
        ? `AI로 DT 채우는 중 (${progress.done}/${progress.total})`
        : "AI로 DT 전체 자동 채우기"}
    </Button>
  );
}
