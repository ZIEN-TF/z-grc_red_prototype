"use client";

import { useRef, useState } from "react";
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
  startFirmwareAnalysis,
  getFirmwareStatus,
  aiFillAssessmentFirmware,
} from "@/app/ai-pipeline-actions";
import {
  aiFillAssets,
  aiFillDTInit,
  aiFillDTIteration,
  aiFillEvidenceAll,
} from "@/app/ai-actions";

type Phase = "idle" | "firmware" | "assets" | "dt" | "evidence" | "assessment" | "done" | "failed";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  firmware: "펌웨어 분석",
  assets: "자산 식별",
  dt: "Decision Tree (인스턴스 포함)",
  evidence: "증빙 정보",
  assessment: "기능 평가",
  done: "완료",
  failed: "실패",
};
const PHASE_ORDER: Phase[] = ["firmware", "assets", "dt", "evidence", "assessment"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AiPipelinePanel({
  projectId,
  hasFirmware,
  disabled,
}: {
  projectId: string;
  hasFirmware: boolean;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [dtDone, setDtDone] = useState(0);
  const [dtTotal, setDtTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const router = useRouter();
  const runningRef = useRef(false);

  const running = phase !== "idle" && phase !== "done" && phase !== "failed";

  async function run() {
    if (runningRef.current) return;
    if (!hasFirmware) {
      toast.error("펌웨어 첨부가 없습니다. 프로젝트 등록 시 펌웨어를 첨부하세요.");
      return;
    }
    const ok = confirm(
      "펌웨어를 분석한 뒤 자산·Decision Tree(인스턴스 포함)·증빙·기능평가를 AI가 순서대로 모두 채웁니다.\n\n" +
        "수 분이 걸리고 토큰 비용이 발생합니다. 진행 중 이 페이지를 닫지 마세요. 계속하시겠습니까?",
    );
    if (!ok) return;

    runningRef.current = true;
    setError(null);
    setWarnings([]);
    const warn: string[] = [];
    try {
      // 1) Firmware analysis (background) → poll until done.
      setPhase("firmware");
      setMessage("펌웨어 분석 시작…");
      let fw = await startFirmwareAnalysis(projectId);
      while (fw && fw.status !== "done" && fw.status !== "failed") {
        await sleep(3000);
        fw = await getFirmwareStatus(projectId);
        setMessage(`펌웨어 추출·분석 중… (${fw?.status ?? "..."})`);
      }
      if (fw?.status === "failed") {
        throw new Error("펌웨어 분석 실패: " + (fw.error ?? "원인 미상"));
      }

      // 2) Assets (full metadata, Korean).
      setPhase("assets");
      setMessage("AI가 펌웨어·문서에서 자산을 식별하는 중…");
      await aiFillAssets(projectId);

      // 3) DT — instance creation (ACM/auth/SUM) + per-iteration fill.
      setPhase("dt");
      setMessage("Decision Tree 준비 중 (인스턴스 생성)…");
      const init = await aiFillDTInit(projectId);
      const iters = init.iterations;
      setDtTotal(iters.length);
      for (let i = 0; i < iters.length; i++) {
        setDtDone(i);
        setMessage(`DT 평가 ${iters[i].label}`);
        try {
          await aiFillDTIteration(projectId, iters[i].requirementId, iters[i].assetKey);
        } catch (e) {
          warn.push(`DT ${iters[i].requirementId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setDtDone(iters.length);

      // 4) Evidence (required information).
      setPhase("evidence");
      setMessage("AI가 증빙 정보를 채우는 중…");
      await aiFillEvidenceAll(projectId);

      // 5) Firmware-grounded functional assessment (+ auto evidence files).
      setPhase("assessment");
      setMessage("AI가 기능 평가를 수행하고 증적을 생성하는 중…");
      const as = await aiFillAssessmentFirmware(projectId);
      if (as.errors.length) warn.push(...as.errors);

      setWarnings(warn);
      setPhase("done");
      router.refresh();
      toast.success("AI 전체 자동 수행이 완료되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("failed");
      toast.error("AI 자동 수행 중 오류가 발생했습니다.");
    } finally {
      runningRef.current = false;
    }
  }

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const dtPct = phase === "dt" && dtTotal > 0 ? Math.round((dtDone / dtTotal) * 100) : null;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="size-5 text-primary" />
          AI 전체 자동 수행 / Run Full AI Assessment
        </CardTitle>
        <CardDescription>
          펌웨어와 첨부 파일을 분석해 자산·Decision Tree(인스턴스 포함)·증빙·기능평가를 한 번에 채웁니다.
          결과는 각 단계 화면에서 검토·수정할 수 있습니다 (AI 자동생성 표시).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!running && (
          <Button onClick={run} disabled={disabled || !hasFirmware}>
            <Sparkles className="mr-2 size-4" />
            AI로 전체 자동 수행
          </Button>
        )}

        {running && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-primary" />
              {PHASE_LABEL[phase]}
              {phaseIdx >= 0 && (
                <span className="text-xs text-muted-foreground">
                  (단계 {phaseIdx + 1}/{PHASE_ORDER.length})
                </span>
              )}
            </div>
            <Progress value={dtPct} />
            <p className="text-xs text-muted-foreground">
              {message}
              {phase === "dt" && dtTotal > 0 && (
                <span> · {dtDone}/{dtTotal}</span>
              )}
            </p>
          </div>
        )}

        {phase === "done" && (
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
            {warnings.length > 0 && (
              <details className="text-xs text-amber-600">
                <summary>일부 항목 경고 {warnings.length}건 (검토 권장)</summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{warnings.join("\n")}</pre>
              </details>
            )}
          </div>
        )}

        {phase === "failed" && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              자동 수행 실패
            </div>
            {error && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {error}
              </pre>
            )}
            <Button onClick={run} variant="outline" size="sm" disabled={disabled}>
              다시 시도
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
