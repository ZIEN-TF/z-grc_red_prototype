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
import {
  createAuthenticatorInstance,
  updateAuthenticatorInstance,
  deleteAuthenticatorInstance,
  type AuthType,
  type PasswordSubtype,
} from "@/app/actions";

type Authenticator = {
  id: string;
  name: string;
  acmId: string;
  authType: AuthType;
  passwordSubtype: PasswordSubtype;
};

type Acm = { id: string; name: string; aum2Pass: boolean };

type SaveState = "idle" | "saving" | "saved" | "error";

export function AuthenticatorInstancePanel({
  projectId,
  acms,
  initial,
  readOnly,
}: {
  projectId: string;
  acms: Acm[];
  initial: Authenticator[];
  readOnly: boolean;
}) {
  const [items, setItems] = useState<Authenticator[]>(initial);

  function updateLocal(id: string, patch: Partial<Authenticator>) {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeLocal(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id));
  }

  async function onAdd(acmId: string) {
    try {
      const res = await createAuthenticatorInstance({
        projectId,
        acmId,
        name: "",
        authType: "",
        passwordSubtype: "",
      });
      setItems((prev) => [
        ...prev,
        {
          id: res.id,
          name: "",
          acmId,
          authType: "",
          passwordSubtype: "",
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "추가 실패";
      toast.error(msg);
      console.error(err);
    }
  }

  const passingAcms = acms.filter((a) => a.aum2Pass);
  const itemsByAcm = new Map<string, Authenticator[]>();
  for (const it of items) {
    const list = itemsByAcm.get(it.acmId) ?? [];
    list.push(it);
    itemsByAcm.set(it.acmId, list);
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          인증자 목록 (메커니즘별)
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            / Authenticators (per ACM)
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          AUM-2가 PASS인 각 접근 통제 메커니즘에 대해, 사용 중인 인증자(비밀번호·PIN·생체·인증서·네트워크 신뢰 등)를
          개별 슬롯으로 등록하세요.
          <br />
          AUM-5-1/5-2/6은 여기 등록된 비밀번호 인증자 중 세부 유형(공장 기본·사용자 설정)에 따라 반복 평가됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {acms.length === 0 && (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            ACM-2에서 등록된 접근 통제 메커니즘이 없습니다. 먼저 ACM-2 페이지에서
            ACM을 등록하세요.
          </p>
        )}

        {acms.length > 0 && passingAcms.length === 0 && (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            아직 AUM-2가 PASS인 ACM이 없습니다. 위 평가에서 각 ACM에 대해 AUM-2를
            PASS로 답변한 뒤 인증자를 등록할 수 있습니다.
          </p>
        )}

        {passingAcms.map((acm) => {
          const list = itemsByAcm.get(acm.id) ?? [];
          return (
            <div key={acm.id} className="rounded-md border bg-background p-3">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-sm font-semibold">
                  {acm.name || "(이름 없음)"}
                </span>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  AUM-2 PASS
                </span>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/20 p-3 text-center text-[11px] text-muted-foreground">
                    아직 등록된 인증자가 없습니다.
                  </p>
                ) : (
                  list.map((item) => (
                    <AuthRow
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
                    onClick={() => onAdd(acm.id)}
                    className="w-full border-dashed text-xs"
                  >
                    <Plus className="mr-1 size-3" />
                    인증자 추가
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {!readOnly && passingAcms.length > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            <p>
              비밀번호 인증자 세부 유형이 "공장 기본"이면 AUM-5-1·AUM-6에서, "사용자 설정"이면
              AUM-5-2·AUM-6에서 반복 평가됩니다. "타사 솔루션" 또는 "해당 없음"인 경우 AUM-5-1/5-2/6
              모두 평가 대상에서 제외됩니다.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuthRow({
  projectId,
  item,
  readOnly,
  onPatch,
  onRemoved,
}: {
  projectId: string;
  item: Authenticator;
  readOnly: boolean;
  onPatch: (patch: Partial<Authenticator>) => void;
  onRemoved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>("idle");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  function commit(next: Authenticator) {
    setState("saving");
    startTransition(async () => {
      try {
        await updateAuthenticatorInstance({
          id: next.id,
          projectId,
          acmId: next.acmId,
          name: next.name,
          authType: next.authType,
          passwordSubtype: next.passwordSubtype,
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
    if (!confirm(`"${item.name || "이 인증자"}"를 삭제하시겠습니까?`)) return;
    startTransition(async () => {
      try {
        await deleteAuthenticatorInstance({ projectId, id: item.id });
        onRemoved();
      } catch (err) {
        toast.error("삭제 실패");
        console.error(err);
      }
    });
  }

  return (
    <div className="rounded-md border bg-muted/20 p-2.5">
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
          placeholder="예: 관리자 비밀번호 / 지문 / TLS 클라이언트 인증서"
          className="flex-1 text-xs"
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
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-1 text-[11px]">
        <span className="text-muted-foreground">인증자 유형:</span>
        <select
          value={item.authType}
          onChange={(e) => {
            const v = e.target.value as AuthType;
            const next: Authenticator = {
              ...item,
              authType: v,
              // Reset subtype if switching away from password
              passwordSubtype: v === "password" ? item.passwordSubtype : "",
            };
            onPatch({ authType: next.authType, passwordSubtype: next.passwordSubtype });
            commit(next);
          }}
          disabled={readOnly || pending}
          className="rounded-md border bg-background px-2 py-1 text-[11px] disabled:opacity-60"
        >
          <option value="">— 선택 —</option>
          <option value="password">비밀번호</option>
          <option value="pin">PIN 코드</option>
          <option value="biometric">생체 인증 (지문·얼굴 등)</option>
          <option value="certificate">인증서 (개인키)</option>
          <option value="network_trust">네트워크 신뢰 (공유 비밀)</option>
          <option value="other">기타</option>
        </select>
      </div>
      {item.authType === "password" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-1 text-[11px]">
          <span className="text-muted-foreground">비밀번호 세부 유형:</span>
          <select
            value={item.passwordSubtype}
            onChange={(e) => {
              const v = e.target.value as PasswordSubtype;
              const next: Authenticator = { ...item, passwordSubtype: v };
              onPatch({ passwordSubtype: v });
              commit(next);
            }}
            disabled={readOnly || pending}
            className="rounded-md border bg-background px-2 py-1 text-[11px] disabled:opacity-60"
          >
            <option value="">— 선택 —</option>
            <option value="factory_default">공장 기본 비밀번호</option>
            <option value="user_set">사용자 설정 비밀번호</option>
            <option value="third_party">타사 솔루션 사용</option>
            <option value="none">해당 없음</option>
          </select>
        </div>
      )}
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
