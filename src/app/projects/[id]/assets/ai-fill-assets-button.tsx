"use client";

import { useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aiFillAssets } from "@/app/ai-actions";

export function AIFillAssetsButton({
  projectId,
  hasAttachments,
  hasExisting,
  disabled,
}: {
  projectId: string;
  hasAttachments: boolean;
  hasExisting: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!hasAttachments) {
      toast.error("AI가 참고할 첨부 파일이 없습니다.");
      return;
    }
    if (hasExisting) {
      const ok = confirm(
        "이미 등록된 자산이 있습니다. AI 자동 채우기는 새 자산을 추가하며, 기존 자산은 그대로 둡니다. 계속하시겠습니까?",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const result = await aiFillAssets(projectId);
        toast.success(`AI가 ${result.inserted}개 자산을 추가했습니다. 검수해 주세요.`);
      } catch (err) {
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
      AI로 자동 채우기
    </Button>
  );
}
