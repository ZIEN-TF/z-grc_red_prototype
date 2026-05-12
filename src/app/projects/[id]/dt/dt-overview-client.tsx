"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  CircleDashed,
  ChevronDown,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { setAllAIDTAnswersReviewed } from "@/app/ai-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MECHANISMS } from "@/lib/mechanisms";
import { cn } from "@/lib/utils";

export type SerializedReqRow = {
  id: string;
  title_ko: string;
  title_en: string;
  iterateDescription_ko?: string;
  isGlobal: boolean;
  totals: { total: number; pass: number; fail: number; na: number; pending: number };
  naFromScreening: boolean;
  failedConditionReason_ko?: string;
};

export type SerializedMechGroup = {
  code: string;
  reqs: SerializedReqRow[];
};

type FilterMode = "all" | "pending" | "fail";

function isAllDone(reqs: SerializedReqRow[]): boolean {
  return reqs.every(
    (r) =>
      r.naFromScreening ||
      (r.totals.total > 0 && r.totals.pending === 0) ||
      (r.totals.total === 0 && !r.isGlobal),
  );
}

export function DTOverviewClient({
  groups,
  projectId,
  selectedStandard,
  mechanismsWithoutDTs,
  aiGeneratedReqIds = [],
}: {
  groups: SerializedMechGroup[];
  projectId: string;
  selectedStandard: number;
  mechanismsWithoutDTs: string[];
  aiGeneratedReqIds?: string[];
}) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [reviewPending, startReviewTransition] = useTransition();
  const router = useRouter();

  function onReviewAllDT() {
    startReviewTransition(async () => {
      await setAllAIDTAnswersReviewed(projectId);
      toast.success("모든 AI DT 답변을 검수 완료로 표시했습니다.");
      router.refresh();
    });
  }

  // Per-group open state — default closed if all requirements are done
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.code] = !isAllDone(g.reqs);
    }
    return init;
  });

  function toggleGroup(code: string) {
    setOpenGroups((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  const filteredGroups = groups
    .map((g) => ({
      ...g,
      reqs: g.reqs.filter((r) => {
        if (filter === "pending") return r.totals.pending > 0;
        if (filter === "fail") return r.totals.fail > 0;
        return true;
      }),
    }))
    .filter((g) => g.reqs.length > 0);

  const totalPending = groups.reduce(
    (s, g) => s + g.reqs.reduce((sr, r) => sr + r.totals.pending, 0),
    0,
  );
  const totalFail = groups.reduce(
    (s, g) => s + g.reqs.reduce((sr, r) => sr + r.totals.fail, 0),
    0,
  );

  return (
    <>
      {/* AI review banner */}
      {aiGeneratedReqIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
          <span className="flex items-center gap-1.5 text-sm text-primary">
            <Sparkles className="size-4" />
            AI가 {aiGeneratedReqIds.length}개 요구사항을 채웠습니다. 내용을 검수해 주세요.
          </span>
          <button
            type="button"
            onClick={onReviewAllDT}
            disabled={reviewPending}
            className="flex h-7 items-center gap-1 rounded-md border border-primary/40 px-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            {reviewPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
            전체 검수 완료 ({aiGeneratedReqIds.length})
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">보기:</span>
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>
          전체
        </FilterBtn>
        <FilterBtn
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
          count={totalPending}
        >
          미완료
        </FilterBtn>
        <FilterBtn
          active={filter === "fail"}
          onClick={() => setFilter("fail")}
          count={totalFail}
          variant="destructive"
        >
          FAIL
        </FilterBtn>
      </div>

      {/* Groups */}
      {filteredGroups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {filter === "pending"
              ? "미완료 요구사항이 없습니다. 모두 완료되었습니다!"
              : "FAIL 항목이 없습니다."}
          </CardContent>
        </Card>
      ) : (
        filteredGroups.map(({ code, reqs }) => {
          const mech = MECHANISMS.find((m) => m.code === code);
          const isOpen = openGroups[code] ?? true;
          const allDone = isAllDone(reqs);

          return (
            <Card key={code} className={cn(allDone && "border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-900/5")}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-t-lg px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                onClick={() => toggleGroup(code)}
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2">
                  {allDone ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 transition-transform text-muted-foreground",
                        isOpen ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  )}
                  <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                    {code}
                  </span>
                  <span className="font-medium text-sm">{mech?.name_ko ?? code}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    / {mech?.name_en ?? code}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {allDone && (
                    <Badge className="h-5 bg-emerald-100 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-400">
                      완료
                    </Badge>
                  )}
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {reqs.length}개
                  </Badge>
                </div>
              </button>

              {isOpen && (
                <CardContent className="space-y-3 pt-0">
                  {mech?.description_ko && (
                    <p className="text-xs text-muted-foreground border-t pt-3">
                      {mech.description_ko}
                    </p>
                  )}
                  {reqs.map((req) => {
                    const doneAll =
                      req.totals.total > 0 && req.totals.pending === 0;
                    const href = `/projects/${projectId}/dt/${req.id}?standard=${selectedStandard}`;
                    const isAiGenerated = aiGeneratedReqIds.includes(req.id);
                    return (
                      <Link
                        key={req.id}
                        href={href}
                        className={cn(
                          "block rounded-lg border p-4 transition hover:border-primary/50 hover:bg-accent/30",
                          isAiGenerated && "border-primary/40 bg-primary/5",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                                {req.id}
                              </span>
                              <span className="text-sm font-medium">
                                {req.title_ko}
                              </span>
                              {isAiGenerated && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  <Sparkles className="size-2.5" /> AI
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {req.title_en}
                            </p>
                            {req.iterateDescription_ko && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                <span className="mr-1 font-medium">반복 단위:</span>
                                {req.iterateDescription_ko}
                              </p>
                            )}
                            {req.isGlobal && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                <span className="mr-1 font-medium">평가 단위:</span>
                                기기 전체 (1회 평가)
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {req.naFromScreening && (
                                <Badge variant="secondary">
                                  <MinusCircle className="mr-1 size-3" />
                                  NOT APPLICABLE
                                </Badge>
                              )}
                              {!req.naFromScreening &&
                                req.totals.total === 0 &&
                                !req.isGlobal && (
                                  <Badge variant="secondary">
                                    <MinusCircle className="mr-1 size-3" />
                                    NOT APPLICABLE
                                  </Badge>
                                )}
                              {req.totals.pass > 0 && (
                                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                                  <CheckCircle2 className="mr-1 size-3" />
                                  PASS {req.totals.pass}
                                </Badge>
                              )}
                              {req.totals.fail > 0 && (
                                <Badge variant="destructive">
                                  <XCircle className="mr-1 size-3" />
                                  FAIL {req.totals.fail}
                                </Badge>
                              )}
                              {!req.naFromScreening && req.totals.na > 0 && (
                                <Badge variant="secondary">
                                  <MinusCircle className="mr-1 size-3" />
                                  N/A {req.totals.na}
                                </Badge>
                              )}
                              {req.totals.pending > 0 && (
                                <Badge variant="outline">
                                  <CircleDashed className="mr-1 size-3" />
                                  {req.totals.pending}
                                </Badge>
                              )}
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {req.naFromScreening ? (
                                <span className="font-medium max-w-xs block">
                                  {req.failedConditionReason_ko ?? "스크리닝 답변에 따라 해당 없음"}
                                </span>
                              ) : req.totals.total === 0 && !req.isGlobal ? (
                                <span className="font-medium">
                                  이 제품·메커니즘 구성에는 해당되지 않습니다
                                </span>
                              ) : doneAll ? (
                                <span className="font-medium text-primary">
                                  완료 / Done
                                </span>
                              ) : (
                                <span>이어하기 / Continue →</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          );
        })
      )}

      {/* Mechanisms without DTs */}
      {mechanismsWithoutDTs.length > 0 && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">
              DT 준비 중 / Pending DTs
            </CardTitle>
            <CardDescription>
              스크리닝 결과 해당되며 본 표준 범위이지만, DT가 아직 추가되지 않은 메커니즘입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {mechanismsWithoutDTs.map((code) => {
                const m = MECHANISMS.find((x) => x.code === code);
                return (
                  <Badge key={code} variant="outline" className="font-mono">
                    {code}
                    {m && (
                      <span className="ml-1 font-sans font-normal text-muted-foreground">
                        · {m.name_ko}
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function FilterBtn({
  active,
  onClick,
  count,
  variant,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  variant?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
        active
          ? variant === "destructive"
            ? "bg-destructive text-destructive-foreground"
            : "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] leading-none",
            active
              ? "bg-white/20"
              : variant === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
