"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, X, Save } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { saveDTNodeAnswer } from "@/app/actions";

type Step = {
  nodeId: string;
  nodeText_ko: string;
  answer: "yes" | "no" | "na";
  prompt_ko: string;
  prompt_en: string;
  notes: string;
  isTerminal: boolean;
};

export function EvidenceForm({
  projectId,
  assetId,
  mechanismCode,
  requirementId,
  steps,
  readOnly = false,
}: {
  projectId: string;
  assetId: string | null;
  mechanismCode: string;
  requirementId: string;
  steps: Step[];
  readOnly?: boolean;
}) {
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(steps.map((s) => [s.nodeId, s.notes])),
  );
  const [savingNode, setSavingNode] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function onChange(nodeId: string, value: string) {
    setNotes((prev) => ({ ...prev, [nodeId]: value }));
  }

  function onSave(nodeId: string) {
    const step = steps.find((s) => s.nodeId === nodeId);
    if (!step) return;
    setSavingNode(nodeId);
    startTransition(async () => {
      try {
        await saveDTNodeAnswer({
          projectId,
          assetId,
          mechanismCode,
          requirementId,
          nodeId,
          answer: step.answer,
          notes: notes[nodeId],
        });
        toast.success("저장되었습니다.");
      } catch (err) {
        toast.error("저장 실패");
        console.error(err);
      } finally {
        setSavingNode(null);
      }
    });
  }

  if (steps.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        이 경로에는 YES로 답한 단계가 없어 증빙 입력이 필요하지 않습니다.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div
          key={step.nodeId}
          className={cn(
            "rounded-md border p-3",
            step.isTerminal && "border-primary/30 bg-primary/5",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              {step.nodeId}
            </span>
            <Badge
              variant={step.answer === "yes" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {step.answer === "yes" ? (
                <>
                  <Check className="mr-0.5 size-3" /> Yes
                </>
              ) : (
                <>
                  <X className="mr-0.5 size-3" /> No
                </>
              )}
            </Badge>
            <p className="flex-1 text-xs text-muted-foreground">
              {step.nodeText_ko}
            </p>
          </div>
          <p className="mt-2 text-[11px] font-medium">
            필요 정보:{" "}
            <span className="font-normal text-muted-foreground">
              {step.prompt_ko}
            </span>
          </p>
          <div className="mt-1.5 flex items-start gap-2">
            <Textarea
              value={notes[step.nodeId] ?? ""}
              onChange={(e) => onChange(step.nodeId, e.target.value)}
              onBlur={() => onSave(step.nodeId)}
              rows={2}
              className="flex-1 text-xs"
              placeholder="내용을 입력하면 포커스가 벗어날 때 자동 저장됩니다."
              disabled={readOnly || savingNode === step.nodeId}
            />
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSave(step.nodeId)}
                disabled={savingNode === step.nodeId}
                className="shrink-0 text-[11px]"
              >
                <Save className="mr-1 size-3" />
                {savingNode === step.nodeId ? "저장 중…" : "저장"}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
