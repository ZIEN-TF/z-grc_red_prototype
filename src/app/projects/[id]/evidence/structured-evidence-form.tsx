"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, CircleDashed, Save, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveDTEvidence } from "@/app/actions";
import type { EvidenceField } from "@/lib/decision-trees";
import { cn } from "@/lib/utils";

type FieldWithValue = { field: EvidenceField; value: string; aiGenerated?: boolean };
type SaveState = "idle" | "saving" | "saved" | "error";

export function StructuredEvidenceForm({
  projectId,
  assetId,
  requirementId,
  fields,
  pathSummary,
  readOnly = false,
}: {
  projectId: string;
  assetId: string | null;
  requirementId: string;
  fields: FieldWithValue[];
  pathSummary?: string;
  readOnly?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.field.id, f.value])),
  );
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [aiFieldIds, setAiFieldIds] = useState<Set<string>>(
    () => new Set(fields.filter((f) => f.aiGenerated).map((f) => f.field.id)),
  );
  const [, startTransition] = useTransition();

  function setFieldState(fieldId: string, state: SaveState) {
    setSaveStates((prev) => ({ ...prev, [fieldId]: state }));
  }

  function onChange(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function onSave(fieldId: string) {
    setFieldState(fieldId, "saving");
    setAiFieldIds((prev) => {
      if (!prev.has(fieldId)) return prev;
      const next = new Set(prev);
      next.delete(fieldId);
      return next;
    });
    startTransition(async () => {
      try {
        await saveDTEvidence({
          projectId,
          assetId,
          requirementId,
          fieldId,
          value: values[fieldId] ?? "",
        });
        setFieldState(fieldId, "saved");
        setTimeout(() => setFieldState(fieldId, "idle"), 1600);
      } catch (err) {
        toast.error("저장 실패");
        console.error(err);
        setFieldState(fieldId, "error");
      }
    });
  }

  if (fields.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        현재 DT 답변에 해당하는 증빙 필드가 없습니다.
      </p>
    );
  }

  // Group fields by group_ko for visual grouping
  const groups = new Map<string, FieldWithValue[]>();
  for (const fv of fields) {
    const key = fv.field.group_ko ?? "";
    const list = groups.get(key) ?? [];
    list.push(fv);
    groups.set(key, list);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([groupLabel, groupFields]) => (
        <div key={groupLabel} className="space-y-2">
          {groupLabel && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {groupLabel}
            </p>
          )}
          {groupFields.map(({ field, value: initialValue }) => {
            const current = values[field.id] ?? initialValue ?? "";
            const state = saveStates[field.id] ?? "idle";
            const isAi = aiFieldIds.has(field.id);
            return (
              <div
                key={field.id}
                className={cn(
                  "rounded-md border bg-muted/20 p-3",
                  isAi && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {field.id}
                    </code>
                    {isAi && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                        <Sparkles className="size-2.5" /> AI
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <SaveIndicator state={state} />
                    {field.required && (
                      <span className="text-[10px] text-destructive">필수</span>
                    )}
                  </div>
                </div>
                <p className="mb-1.5 text-xs text-foreground">
                  {field.prompt_ko}
                </p>
                {field.showPathAbove && pathSummary && (
                  <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]">
                    <div className="mb-0.5 font-medium text-primary">
                      선택된 Decision Tree 경로
                    </div>
                    <code className="block font-mono text-[11px] text-foreground">
                      {pathSummary}
                    </code>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  {field.multiline ? (
                    <Textarea
                      value={current}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      onBlur={() => onSave(field.id)}
                      rows={3}
                      className="flex-1 text-xs"
                      placeholder="내용 입력 후 포커스가 벗어나면 자동 저장됩니다."
                      disabled={readOnly || state === "saving"}
                    />
                  ) : (
                    <Input
                      value={current}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      onBlur={() => onSave(field.id)}
                      className="flex-1 text-xs"
                      disabled={readOnly || state === "saving"}
                    />
                  )}
                  {!readOnly && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSave(field.id)}
                      disabled={state === "saving"}
                      className="shrink-0 text-[11px]"
                    >
                      <Save className="mr-1 size-3" />
                      {state === "saving" ? "저장…" : "저장"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <CircleDashed className="size-2.5 animate-pulse" />
        저장 중
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
        <Check className="size-2.5" />
        저장됨
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
      저장 실패
    </span>
  );
}
