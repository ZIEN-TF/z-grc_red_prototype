"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2, Check, CircleDashed, Info } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  createAcmInstance,
  updateAcmInstance,
  deleteAcmInstance,
} from "@/app/actions";

type AcmInstance = {
  id: string;
  name: string;
  interfaceNetwork: boolean;
  interfaceUser: boolean;
  interfaceMachine: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

export function AcmInstancePanel({
  projectId,
  initial,
  readOnly,
}: {
  projectId: string;
  initial: AcmInstance[];
  readOnly: boolean;
}) {
  const [items, setItems] = useState<AcmInstance[]>(initial);

  function updateLocal(id: string, patch: Partial<AcmInstance>) {
    setItems((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }

  async function onAdd() {
    const draft: AcmInstance = {
      id: "tmp-" + Math.random().toString(36).slice(2),
      name: "",
      interfaceNetwork: false,
      interfaceUser: false,
      interfaceMachine: false,
    };
    try {
      const res = await createAcmInstance({
        projectId,
        name: draft.name || "(이름 없음)",
        interfaceNetwork: false,
        interfaceUser: false,
        interfaceMachine: false,
      });
      setItems((prev) => [...prev, { ...draft, id: res.id }]);
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
          접근 통제 메커니즘 목록
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            / Access Control Mechanisms
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          본 기기의 각 접근 통제 메커니즘 이름을 등록하고 어느 인터페이스에서 동작하는지 체크하세요.
          <br />
          AUM 요구사항은 여기 등록된 각 ACM에 대해 반복 평가됩니다 (인터페이스 종류에 따라).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            아직 등록된 ACM이 없습니다. 아래 "ACM 추가" 버튼으로 입력하세요.
          </p>
        ) : (
          items.map((item) => (
            <AcmRow
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
            ACM 추가
          </Button>
        )}

        {!readOnly && (
          <div className="flex items-start gap-2 rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            <p>
              AUM-1-1은 네트워크 인터페이스 ACM, AUM-1-2는 사용자 인터페이스 ACM, AUM-1-3은
              (EN 18031-3 전용) 머신 인터페이스 ACM에 대해 평가됩니다. AUM-2/3/4/5-1/5-2/6은
              모든 ACM에 대해 평가됩니다.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AcmRow({
  projectId,
  item,
  readOnly,
  onPatch,
  onRemoved,
}: {
  projectId: string;
  item: AcmInstance;
  readOnly: boolean;
  onPatch: (patch: Partial<AcmInstance>) => void;
  onRemoved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>("idle");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  function commit(next: AcmInstance) {
    setState("saving");
    startTransition(async () => {
      try {
        await updateAcmInstance({
          id: next.id,
          projectId,
          name: next.name,
          interfaceNetwork: next.interfaceNetwork,
          interfaceUser: next.interfaceUser,
          interfaceMachine: next.interfaceMachine,
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

  function onInterfaceToggle(
    key: "interfaceNetwork" | "interfaceUser" | "interfaceMachine",
    value: boolean,
  ) {
    const next = { ...item, [key]: value };
    onPatch({ [key]: value });
    commit(next);
  }

  function onRemove() {
    if (!confirm(`"${item.name || "이 ACM"}"을 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      try {
        await deleteAcmInstance({ projectId, id: item.id });
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
          placeholder="예: 관리자 로그인 / API 토큰 인증"
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
      <div className="mt-2 flex flex-wrap items-center gap-4 pl-1 text-xs">
        <span className="text-muted-foreground">관리 인터페이스:</span>
        <InterfaceToggle
          label="네트워크"
          checked={item.interfaceNetwork}
          onChange={(v) => onInterfaceToggle("interfaceNetwork", v)}
          disabled={readOnly || pending}
        />
        <InterfaceToggle
          label="사용자"
          checked={item.interfaceUser}
          onChange={(v) => onInterfaceToggle("interfaceUser", v)}
          disabled={readOnly || pending}
        />
        <InterfaceToggle
          label="머신"
          checked={item.interfaceMachine}
          onChange={(v) => onInterfaceToggle("interfaceMachine", v)}
          disabled={readOnly || pending}
        />
      </div>
    </div>
  );
}

function InterfaceToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5",
        checked ? "bg-primary/10 text-primary" : "text-foreground",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
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
