"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Check,
  X,
  CheckCircle2,
  XCircle,
  MinusCircle,
  RotateCcw,
  CircleDashed,
  Undo2,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  walkTree,
  evidencePromptFor,
  type DTOutcome,
  type DTRequirement,
  type DTNode,
  type PathStep,
} from "@/lib/decision-trees";
import {
  resetDTEvaluation,
  revertDTNodeAndAfter,
  saveDTNodeAnswer,
} from "@/app/actions";

type InitialAnswer = {
  assetId: string | null;
  nodeId: string;
  answer: "yes" | "no";
  notes: string;
};

type MatchingAsset = {
  id: string;
  name: string;
  kindLabel: string;
};

// assetKey: assetId or "__global__"
function aKey(assetId: string | null) {
  return assetId ?? "__global__";
}

type NAGateMessage = {
  reason_ko?: string;
  reason_en?: string;
  linkedReqId: string;
} | null;

export function RequirementEvaluator({
  projectId,
  requirement,
  matchingAssets,
  initialAnswers,
  autoNAByAsset,
  naGateMessage,
}: {
  projectId: string;
  requirement: DTRequirement;
  matchingAssets: MatchingAsset[];
  initialAnswers: InitialAnswer[];
  autoNAByAsset: Record<string, boolean>;
  naGateMessage: NAGateMessage;
}) {
  // Map assetKey → { [nodeId]: "yes" | "no" }
  const [answers, setAnswers] = useState<
    Record<string, Record<string, "yes" | "no">>
  >(() => {
    const out: Record<string, Record<string, "yes" | "no">> = {};
    for (const a of initialAnswers) {
      const k = aKey(a.assetId);
      if (!out[k]) out[k] = {};
      out[k][a.nodeId] = a.answer;
    }
    return out;
  });

  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const a of initialAnswers) {
      out[`${aKey(a.assetId)}::${a.nodeId}`] = a.notes ?? "";
    }
    return out;
  });

  if (requirement.iterateOver && matchingAssets.length === 0) {
    return (
      <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              해당하는 자산이 등록되지 않았습니다. / No matching assets.
            </p>
            <p className="text-xs text-muted-foreground">
              이 요구사항은 등록된 자산이 없어 평가할 수 없습니다. 자산 인벤토리에서 관련 자산을 추가해 주세요.
            </p>
            <a
              href={`/projects/${projectId}/assets`}
              className="mt-1 inline-block text-xs text-primary underline"
            >
              자산 인벤토리로 / Go to Asset Inventory
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!requirement.iterateOver) {
    const globalAutoNA = autoNAByAsset["__global__"] ?? false;
    return (
      <div className="space-y-4">
        {globalAutoNA ? (
          <AutoNACard naGateMessage={naGateMessage} />
        ) : (
          <AssetEvaluationCard
            projectId={projectId}
            requirement={requirement}
            assetId={null}
            assetLabel={null}
            answers={answers[aKey(null)] ?? {}}
            notes={notes}
            setAnswers={setAnswers}
            setNotes={setNotes}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {matchingAssets.map((a) =>
        autoNAByAsset[a.id] ? (
          <AutoNACard
            key={a.id}
            assetLabel={a}
            naGateMessage={naGateMessage}
          />
        ) : (
          <AssetEvaluationCard
            key={a.id}
            projectId={projectId}
            requirement={requirement}
            assetId={a.id}
            assetLabel={a}
            answers={answers[aKey(a.id)] ?? {}}
            notes={notes}
            setAnswers={setAnswers}
            setNotes={setNotes}
          />
        ),
      )}
    </div>
  );
}

function AutoNACard({
  assetLabel,
  naGateMessage,
}: {
  assetLabel?: MatchingAsset;
  naGateMessage: NAGateMessage;
}) {
  return (
    <Card className="border-muted-foreground/30 bg-muted/30">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {assetLabel ? (
              <>
                <CardTitle className="text-base">{assetLabel.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {assetLabel.kindLabel}
                </p>
              </>
            ) : (
              <CardTitle className="text-base">
                기기 전체 평가 / Global Evaluation
              </CardTitle>
            )}
          </div>
          <Badge variant="secondary" className="gap-1">
            <MinusCircle className="size-3" />
            AUTO — NOT APPLICABLE
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm">
        <p className="text-muted-foreground">
          {naGateMessage?.reason_ko ??
            `연결된 요구사항 ${naGateMessage?.linkedReqId}의 결과에 따라 자동으로 NOT APPLICABLE 처리됩니다.`}
        </p>
        {naGateMessage?.reason_en && (
          <p className="mt-1 text-xs italic text-muted-foreground">
            {naGateMessage.reason_en}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AssetEvaluationCard({
  projectId,
  requirement,
  assetId,
  assetLabel,
  answers,
  notes,
  setAnswers,
  setNotes,
}: {
  projectId: string;
  requirement: DTRequirement;
  assetId: string | null;
  assetLabel: MatchingAsset | null;
  answers: Record<string, "yes" | "no">;
  notes: Record<string, string>;
  setAnswers: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, "yes" | "no">>>
  >;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const [pending, startTransition] = useTransition();

  const walk = useMemo(
    () => walkTree(requirement, answers),
    [requirement, answers],
  );

  // When the requirement has its own structured evidence schema, the DT form
  // should NOT collect per-step "evidence/notes" — those details are captured
  // in the dedicated Evidence page. Showing them here creates duplicate fields.
  const hasStructuredEvidence =
    Array.isArray(requirement.evidenceFields) &&
    requirement.evidenceFields.length > 0;

  function onAnswer(nodeId: string, value: "yes" | "no") {
    // Optimistic update
    setAnswers((prev) => ({
      ...prev,
      [aKey(assetId)]: { ...(prev[aKey(assetId)] ?? {}), [nodeId]: value },
    }));
    const noteKey = `${aKey(assetId)}::${nodeId}`;
    startTransition(async () => {
      try {
        await saveDTNodeAnswer({
          projectId,
          assetId,
          mechanismCode: requirement.mechanismCode,
          requirementId: requirement.id,
          nodeId,
          answer: value,
          notes: notes[noteKey],
        });
      } catch (err) {
        toast.error("저장 실패 / Failed to save.");
        console.error(err);
      }
    });
  }

  function onChangePriorAnswer(step: PathStep) {
    // Revert from this step onwards (this step + later steps) then it
    // becomes the active question again.
    const idx = walk.path.findIndex((p) => p.nodeId === step.nodeId);
    if (idx < 0) return;
    const later = walk.path.slice(idx + 1).map((p) => p.nodeId);

    // Optimistic: remove this node and later from answers
    setAnswers((prev) => {
      const next = { ...(prev[aKey(assetId)] ?? {}) };
      delete next[step.nodeId];
      for (const n of later) delete next[n];
      return { ...prev, [aKey(assetId)]: next };
    });

    startTransition(async () => {
      try {
        await revertDTNodeAndAfter({
          projectId,
          assetId,
          requirementId: requirement.id,
          fromNodeId: step.nodeId,
          afterNodeIds: later,
        });
      } catch (err) {
        toast.error("되돌리기 실패 / Failed to revert.");
        console.error(err);
      }
    });
  }

  function onReset() {
    if (!confirm("이 자산의 평가를 처음부터 다시 하시겠습니까?")) return;
    setAnswers((prev) => ({ ...prev, [aKey(assetId)]: {} }));
    startTransition(async () => {
      try {
        await resetDTEvaluation({
          projectId,
          assetId,
          requirementId: requirement.id,
        });
      } catch (err) {
        toast.error("초기화 실패 / Failed to reset.");
        console.error(err);
      }
    });
  }

  function onSaveNotes(nodeId: string, value: string) {
    const noteKey = `${aKey(assetId)}::${nodeId}`;
    setNotes((prev) => ({ ...prev, [noteKey]: value }));
  }

  function onCommitNotes(nodeId: string) {
    const noteKey = `${aKey(assetId)}::${nodeId}`;
    const currentAnswer = answers[nodeId];
    if (!currentAnswer) return; // no answer yet; nothing to save
    startTransition(async () => {
      try {
        await saveDTNodeAnswer({
          projectId,
          assetId,
          mechanismCode: requirement.mechanismCode,
          requirementId: requirement.id,
          nodeId,
          answer: currentAnswer,
          notes: notes[noteKey],
        });
      } catch (err) {
        console.error(err);
      }
    });
  }

  const outcomeBadge =
    walk.kind === "outcome" ? (
      <OutcomeBadge outcome={walk.outcome} />
    ) : (
      <Badge variant="outline" className="gap-1">
        <CircleDashed className="size-3" />
        진행중 / In progress
      </Badge>
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {assetLabel ? (
              <>
                <CardTitle className="text-base">{assetLabel.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {assetLabel.kindLabel}
                </p>
              </>
            ) : (
              <CardTitle className="text-base">
                기기 전체 평가 / Global Evaluation
              </CardTitle>
            )}
          </div>
          <div className="flex items-center gap-2">
            {outcomeBadge}
            {walk.path.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onReset}
                disabled={pending}
                aria-label="Reset"
              >
                <RotateCcw className="mr-1 size-3" />
                초기화 / Reset
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {walk.path.map((step) => {
          const node = requirement.nodes[step.nodeId];
          const noteKey = `${aKey(assetId)}::${step.nodeId}`;
          return (
            <AnsweredStep
              key={step.nodeId}
              node={node}
              answer={step.answer}
              notes={notes[noteKey] ?? ""}
              onNotes={(v) => {
                onSaveNotes(step.nodeId, v);
              }}
              onCommitNotes={() => onCommitNotes(step.nodeId)}
              onChange={() => onChangePriorAnswer(step)}
              disabled={pending}
              hasStructuredEvidence={hasStructuredEvidence}
            />
          );
        })}

        {walk.kind === "question" ? (
          <ActiveQuestion
            node={requirement.nodes[walk.nodeId]}
            onAnswer={(a) => onAnswer(walk.nodeId, a)}
            disabled={pending}
            hasStructuredEvidence={hasStructuredEvidence}
          />
        ) : (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-sm">
              <OutcomeIcon outcome={walk.outcome} />
              <span className="font-medium">
                판정 / Outcome:{" "}
                <OutcomeText outcome={walk.outcome} />
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              위 경로를 따라 본 자산(또는 기기)은 {outcomeDescKo(walk.outcome)}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnsweredStep({
  node,
  answer,
  notes,
  onNotes,
  onCommitNotes,
  onChange,
  disabled,
  hasStructuredEvidence,
}: {
  node: DTNode;
  answer: "yes" | "no";
  notes: string;
  onNotes: (v: string) => void;
  onCommitNotes: () => void;
  onChange: () => void;
  disabled?: boolean;
  hasStructuredEvidence?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {node.id}
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium leading-snug text-muted-foreground line-through decoration-muted-foreground/30">
            {node.text_ko}
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground/70 line-through decoration-muted-foreground/30">
            {node.text_en}
          </p>
        </div>
        <Badge
          className={cn(
            "shrink-0 text-[11px]",
            answer === "yes"
              ? "bg-primary/20 text-primary hover:bg-primary/20"
              : "bg-muted text-foreground hover:bg-muted",
          )}
        >
          {answer === "yes" ? "Yes" : "No"}
        </Badge>
      </div>
      {answer === "yes" && !hasStructuredEvidence ? (
        <div className="mt-2 space-y-1 pl-8">
          <p className="text-[11px] font-medium text-foreground">
            증빙·근거:{" "}
            <span className="font-normal text-muted-foreground">
              {evidencePromptFor(node, answer).ko}
            </span>
          </p>
          <div className="flex items-start gap-2">
            <Textarea
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              onBlur={onCommitNotes}
              placeholder="이 단계의 근거를 기술하세요…"
              rows={2}
              className="flex-1 text-xs"
              disabled={disabled}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={onChange}
              disabled={disabled}
              className="shrink-0 text-[11px]"
            >
              <Undo2 className="mr-1 size-3" />
              답변 변경
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex justify-end pl-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={onChange}
            disabled={disabled}
            className="text-[11px] text-muted-foreground"
          >
            <Undo2 className="mr-1 size-3" />
            답변 변경
          </Button>
        </div>
      )}
    </div>
  );
}

function ActiveQuestion({
  node,
  onAnswer,
  disabled,
  hasStructuredEvidence,
}: {
  node: DTNode;
  onAnswer: (a: "yes" | "no") => void;
  disabled?: boolean;
  hasStructuredEvidence?: boolean;
}) {
  return (
    <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded bg-primary px-2 py-1 font-mono text-xs text-primary-foreground">
          {node.id}
        </span>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium leading-snug">{node.text_ko}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {node.text_en}
          </p>
          {node.hint_ko && (
            <p className="mt-2 rounded-md bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground">
              {node.hint_ko}
              {node.hint_en && (
                <>
                  <br />
                  <span className="italic">{node.hint_en}</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-11">
        <Button
          type="button"
          size="sm"
          onClick={() => onAnswer("yes")}
          disabled={disabled}
          className="min-w-24 bg-primary"
        >
          <Check className="mr-1 size-4" />
          Yes
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onAnswer("no")}
          disabled={disabled}
          className="min-w-24"
        >
          <X className="mr-1 size-4" />
          No
        </Button>
        {!hasStructuredEvidence && (
          <p className="flex-1 text-[11px] text-muted-foreground">
            Yes 답변 시 해당 단계의 증빙·근거 입력란이 나타납니다.
          </p>
        )}
        {hasStructuredEvidence && (
          <p className="flex-1 text-[11px] text-muted-foreground">
            상세 증빙은 「증빙 정보 입력」 페이지에서 수집합니다.
          </p>
        )}
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: DTOutcome }) {
  if (outcome === "pass")
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 size-3" />
        PASS
      </Badge>
    );
  if (outcome === "fail")
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 size-3" />
        FAIL
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <MinusCircle className="mr-1 size-3" />
      NOT APPLICABLE
    </Badge>
  );
}

function OutcomeIcon({ outcome }: { outcome: DTOutcome }) {
  if (outcome === "pass")
    return <CheckCircle2 className="size-5 text-emerald-600" />;
  if (outcome === "fail") return <XCircle className="size-5 text-destructive" />;
  return <MinusCircle className="size-5 text-muted-foreground" />;
}

function OutcomeText({ outcome }: { outcome: DTOutcome }) {
  if (outcome === "pass")
    return <span className="text-emerald-700 dark:text-emerald-400">PASS</span>;
  if (outcome === "fail")
    return <span className="text-destructive">FAIL</span>;
  return <span className="text-muted-foreground">NOT APPLICABLE</span>;
}

function outcomeDescKo(outcome: DTOutcome) {
  if (outcome === "pass") return "요구사항을 충족합니다 (PASS)";
  if (outcome === "fail") return "요구사항을 충족하지 못합니다 (FAIL)";
  return "해당되지 않습니다 (NOT APPLICABLE)";
}
