"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2, Check, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createSumInstance,
  updateSumInstance,
  deleteSumInstance,
} from "@/app/actions";

type SumInstance = { id: string; name: string };
type SaveState = "idle" | "saving" | "saved" | "error";

export function SumInstancePanel({
  projectId,
  initial,
  readOnly,
}: {
  projectId: string;
  initial: SumInstance[];
  readOnly: boolean;
}) {
  const [items, setItems] = useState<SumInstance[]>(initial);

  function updateLocal(id: string, patch: Partial<SumInstance>) {
    setItems((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }

  async function onAdd() {
    try {
      const res = await createSumInstance({
        projectId,
        name: "",
      });
      setItems((prev) => [...prev, { id: res.id, name: "" }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "추가 실패";
      toast.error(msg);
      console.error(err);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          보안 업데이트 메커니즘 목록
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            / Secure Update Mechanisms
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          SUM-1이 PASS로 판정된 경우, 해당 업데이트 메커니즘의 이름을 등록하세요.
          <br />
          SUM-2(보안 업데이트)와 SUM-3(자동 업데이트)은 여기 등록된 각 메커니즘에 대해
          반복 평가됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            아직 등록된 업데이트 메커니즘이 없습니다. 아래 "업데이트 메커니즘 추가"
            버튼으로 입력하세요.
          </p>
        ) : (
          items.map((item) => (
            <SumRow
              key={item.id}
              projectId={projectId}
              item={item}
              readOnly={readOnly}
              onPatch={(patch) => updateLocal(item.id, patch)}
              onRemoved={() => removeLocal(item.id)}
            />
          ))
        )}

        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdd}
            className="w-full border-dashed"
          >
            <Plus className="mr-1 size-3.5" />
            업데이트 메커니즘 추가
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SumRow({
  projectId,
  item,
  readOnly,
  onPatch,
  onRemoved,
}: {
  projectId: string;
  item: SumInstance;
  readOnly: boolean;
  onPatch: (patch: Partial<SumInstance>) => void;
  onRemoved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>("idle");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  function commit(next: SumInstance) {
    setState("saving");
    startTransition(async () => {
      try {
        await updateSumInstance({
          projectId,
          id: next.id,
          name: next.name,
        });
        setState("saved");
        setTimeout(() => setState("idle"), 1400);
      } catch (err) {
        toast.error("저장 실패");
        console.error(err);
        setState("error");
      }
    });
  }

  function onNameChange(v: string) {
    onPatch({ name: v });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      commit({ ...item, name: v });
    }, 1500);
  }

  function onRemove() {
    if (!confirm(`"${item.name || "이 메커니즘"}"을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      try {
        await deleteSumInstance({ projectId, id: item.id });
        onRemoved();
      } catch (err) {
        toast.error("삭제 실패");
        console.error(err);
      }
    });
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={item.name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={() => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            commit(item);
          }}
          placeholder="예: OTA 펌웨어 업데이트 / 서명된 이미지 업데이트"
          className="flex-1 text-sm"
          disabled={readOnly || pending}
        />
        <SaveIndicator state={state} />
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
            aria-label="삭제"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
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
