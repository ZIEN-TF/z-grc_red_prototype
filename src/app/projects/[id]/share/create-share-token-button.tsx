"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createShareToken } from "@/app/actions";
import { toast } from "sonner";

export function CreateShareTokenButton({ projectId }: { projectId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function handleClick() {
    start(async () => {
      try {
        await createShareToken(projectId);
        router.refresh();
        toast.success("공유 링크가 생성되었습니다.");
      } catch (e) {
        toast.error("공유 링크 생성 실패");
        console.error(e);
      }
    });
  }

  return (
    <Button size="sm" onClick={handleClick} disabled={pending}>
      <Plus className="mr-1 size-4" />
      {pending ? "생성 중…" : "새 링크 생성"}
    </Button>
  );
}
