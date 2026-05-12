"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setEvidenceReviewed } from "@/app/ai-actions";

export function EvidenceAIReviewBanner({
  projectId,
  count,
  evidenceIds,
}: {
  projectId: string;
  count: number;
  evidenceIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (count === 0) return null;

  function onReviewAll() {
    startTransition(async () => {
      await setEvidenceReviewed({ projectId, evidenceIds, reviewed: true });
      toast.success("모든 AI 증빙 필드를 검수 완료로 표시했습니다.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
      <span className="flex items-center gap-1.5 text-sm text-primary">
        <Sparkles className="size-4" />
        AI가 {count}개 증빙 필드를 채웠습니다. 내용을 검수해 주세요.
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onReviewAll}
        disabled={pending}
        className="h-7 px-2 text-xs border-primary/40 text-primary"
      >
        {pending ? (
          <Loader2 className="mr-1 size-3 animate-spin" />
        ) : (
          <Sparkles className="mr-1 size-3" />
        )}
        전체 검수 완료 ({count})
      </Button>
    </div>
  );
}
