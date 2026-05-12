"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteProject } from "@/app/actions";

export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`"${projectName}" 프로젝트를 삭제하시겠습니까?\n\n모든 평가 데이터가 영구 삭제되며 복구할 수 없습니다.`))
      return;
    startTransition(async () => {
      try {
        await deleteProject(projectId);
        toast.success("프로젝트가 삭제되었습니다.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "삭제 실패");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      aria-label="프로젝트 삭제"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
