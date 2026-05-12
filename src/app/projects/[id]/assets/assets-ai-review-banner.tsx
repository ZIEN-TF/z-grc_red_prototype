"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setAssetsReviewed } from "@/app/ai-actions";

export function AssetsAIReviewBanner({
  projectId,
  count,
  assetIds,
}: {
  projectId: string;
  count: number;
  assetIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (count === 0) return null;

  function onReviewAll() {
    startTransition(async () => {
      await setAssetsReviewed({ projectId, assetIds, reviewed: true });
      toast.success("모든 AI 자산을 검수 완료로 표시했습니다.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
      <span className="flex items-center gap-1.5 text-sm text-primary">
        <Sparkles className="size-4" />
        AI가 {count}개 자산을 채웠습니다. 내용을 검수해 주세요.
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
