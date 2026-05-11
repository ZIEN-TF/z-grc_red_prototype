"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revokeShareToken } from "@/app/actions";
import { toast } from "sonner";

export function RevokeShareTokenButton({
  tokenId,
  projectId,
}: {
  tokenId: string;
  projectId: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function handleClick() {
    start(async () => {
      try {
        await revokeShareToken({ tokenId, projectId });
        router.refresh();
        toast.success("공유 링크가 삭제되었습니다.");
      } catch (e) {
        toast.error("삭제 실패");
        console.error(e);
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-[11px] text-destructive hover:text-destructive"
      onClick={handleClick}
      disabled={pending}
    >
      <Trash2 className="mr-1 size-3" />
      {pending ? "삭제 중…" : "삭제"}
    </Button>
  );
}
