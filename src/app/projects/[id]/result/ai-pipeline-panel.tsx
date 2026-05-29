"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  startAiPipeline,
  getAiPipelineStatus,
  type PipelineStatus,
} from "@/app/ai-pipeline-actions";

const STEP_LABEL: Record<string, string> = {
  firmware: "펌웨어 분석",
  assets: "자산 식별",
  dt: "Decision Tree",
  evidence: "증빙 정보",
  assessment: "기능 평가",
  done: "완료",
};
const STEP_ORDER = ["firmware", "assets", "dt", "evidence", "assessment"];

export function AiPipelinePanel({
  projectId,
  initial,
  hasFirmware,
  disabled,
}: {
  projectId: string;
  initial: PipelineStatus;
  hasFirmware: boolean;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<PipelineStatus>(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = status?.status === "queued" || status?.status === "running";

  // Poll while a run is active.
  useEffect(() => {
    if (!active) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(async () => {
      try {
        const s = await getAiPipelineStatus(projectId);
        setStatus(s);
        if (s && (s.status === "done" || s.status === "failed")) {
          if (timer.current) clearInterval(timer.current);
          router.refresh();
          if (s.status === "done") toast.success("AI 전체 자동 수행이 완료되었습니다.");
          else toast.error("AI 자동 수행 중 오류가 발생했습니다.");
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, projectId, router]);

  function onStart() {
    if (!hasFirmware) {
      toast.error("펌웨어 첨부가 없습니다. 프로젝트 등록 시 펌웨어를 첨부하세요.");
      return;
    }
    const ok = confirm(
      "펌웨어를 분석한 뒤 자산·Decision Tree·증빙·기능평가를 AI가 모두 자동으로 채웁니다.\n\n" +
        "수 분이 걸리고 토큰 비용이 발생합니다. 기존 AI 자동생성 항목은 갱신됩니다. 계속하시겠습니까?",
    );
    if (!ok) return;
    startTransition(async () => {
      try {
        const s = await startAiPipeline(projectId);
        setStatus(s);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "시작 실패");
      }
    });
  }

  const stepIdx = status ? STEP_ORDER.indexOf(status.step) : -1;
  const withinPct =
    status && status.total > 0 ? Math.round((status.completed / status.total) * 100) : null;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="size-5 text-primary" />
          AI 전체 자동 수행 / Run Full AI Assessment
        </CardTitle>
        <CardDescription>
          펌웨어와 첨부 파일을 분석해 자산·Decision Tree·증빙·기능평가를 한 번에 채웁니다.
          결과는 각 단계 화면에서 검토·수정할 수 있습니다 (AI 자동생성 표시).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!active && (
          <Button onClick={onStart} disabled={disabled || pending || !hasFirmware}>
            {pending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            AI로 전체 자동 수행
          </Button>
        )}

        {status && active && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-primary" />
              {STEP_LABEL[status.step] ?? status.step}
              {stepIdx >= 0 && (
                <span className="text-xs text-muted-foreground">
                  (단계 {stepIdx + 1}/{STEP_ORDER.length})
                </span>
              )}
            </div>
            <Progress value={withinPct} />
            <p className="text-xs text-muted-foreground">
              {status.message}
              {withinPct !== null && status.total > 1 && (
                <span> · {status.completed}/{status.total}</span>
              )}
            </p>
          </div>
        )}

        {status && status.status === "done" && (
          <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="size-4" />
              자동 수행 완료 — 각 화면에서 검토하세요
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/projects/${projectId}/assets`}>
                <Button variant="outline" size="sm">자산 검토</Button>
              </Link>
              <Link href={`/projects/${projectId}/dt`}>
                <Button variant="outline" size="sm">Decision Tree</Button>
              </Link>
              <Link href={`/projects/${projectId}/evidence`}>
                <Button variant="outline" size="sm">증빙</Button>
              </Link>
              <Link href={`/projects/${projectId}/assessment`}>
                <Button size="sm">기능 평가</Button>
              </Link>
            </div>
            {status.error && (
              <p className="text-xs text-amber-600">
                일부 항목에서 오류가 있었습니다 (콘솔/관리자 확인). 검토를 권장합니다.
              </p>
            )}
          </div>
        )}

        {status && status.status === "failed" && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              자동 수행 실패
            </div>
            {status.error && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {status.error}
              </pre>
            )}
            <Button onClick={onStart} variant="outline" size="sm" disabled={disabled || pending}>
              다시 시도
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
