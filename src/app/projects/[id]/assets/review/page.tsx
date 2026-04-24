import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Pencil,
  CircleAlert,
  CheckCircle2,
} from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ASSET_ONLY_KINDS,
  applicableAssetKinds,
  kindConfig,
  optionLabel,
} from "@/lib/asset-kinds";
import type { StandardId } from "@/lib/mechanisms";

export default async function AssetsReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { assets: { orderBy: { createdAt: "asc" } } },
  });
  if (!project) notFound();

  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);
  const ASSET_KINDS = project.screeningComplete && applicableStandards.length > 0
    ? applicableAssetKinds(applicableStandards)
    : ASSET_ONLY_KINDS;

  // Only count assets that belong to applicable kinds
  const applicableKindSet = new Set(ASSET_KINDS.map((k) => k.kind));
  const total = project.assets.filter((a) =>
    applicableKindSet.has(a.kind as never),
  ).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/projects/${project.id}/assets`}>
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            자산 입력 / Edit Inventory
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          자산 검토
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Asset Review
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          제품: <span className="font-medium text-foreground">{project.name}</span>
          {" · "}
          {project.manufacturer}
        </p>
      </div>

      <Card
        className={
          total === 0
            ? "border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20"
            : "border-primary/30 bg-primary/5"
        }
      >
        <CardContent className="flex items-center gap-3 py-4">
          {total === 0 ? (
            <>
              <CircleAlert className="size-5 text-amber-600" />
              <div>
                <p className="text-sm font-medium">
                  등록된 자산이 없습니다. / No assets registered.
                </p>
                <p className="text-xs text-muted-foreground">
                  Decision Tree 평가를 진행하려면 최소 1개 이상의 자산이 필요합니다.
                </p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-5 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  총 {total}개 자산이 등록되었습니다. / {total} asset(s) registered.
                </p>
                <p className="text-xs text-muted-foreground">
                  아래 내용을 확인하고, 수정이 필요하면 "자산 입력으로 돌아가기"를 누르세요.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {ASSET_KINDS.map((kind) => {
        const items = project.assets.filter((a) => a.kind === kind.kind);
        return (
          <Card key={kind.kind}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-lg">
                <span>
                  {kind.title_ko}
                  <span className="ml-2 text-sm font-medium text-muted-foreground">
                    / {kind.title_en}
                  </span>
                </span>
                <Badge variant="secondary">{items.length}개 / items</Badge>
              </CardTitle>
              <CardDescription>{kind.description_ko}</CardDescription>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                  등록된 항목 없음 / None registered
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>이름 / Name</TableHead>
                        {kind.metadataFields.map((f) => (
                          <TableHead key={f.name}>
                            {f.label_ko}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              / {f.label_en}
                            </span>
                          </TableHead>
                        ))}
                        <TableHead>설명 / Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((a) => {
                        const meta = safeJson(a.metadata);
                        const cfg = kindConfig(kind.kind)!;
                        return (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium">
                              {a.name}
                            </TableCell>
                            {kind.metadataFields.map((f) => {
                              const raw = meta[f.name] ?? "";
                              if (!raw) {
                                return (
                                  <TableCell
                                    key={f.name}
                                    className="text-muted-foreground/60"
                                  >
                                    —
                                  </TableCell>
                                );
                              }
                              if (f.type === "select") {
                                const lbl = optionLabel(cfg, f.name, raw);
                                return (
                                  <TableCell key={f.name}>
                                    <span>{lbl.ko}</span>
                                    {lbl.ko !== lbl.en && (
                                      <span className="ml-1 text-xs text-muted-foreground">
                                        / {lbl.en}
                                      </span>
                                    )}
                                  </TableCell>
                                );
                              }
                              return <TableCell key={f.name}>{raw}</TableCell>;
                            })}
                            <TableCell className="text-sm text-muted-foreground">
                              {a.description || "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex items-center justify-between gap-4 py-4">
        <Link href={`/projects/${project.id}/assets`}>
          <Button variant="outline">
            <Pencil className="mr-2 size-4" />
            자산 입력으로 돌아가기 / Edit Inventory
          </Button>
        </Link>
        <Link href={`/projects/${project.id}/dt`}>
          <Button>
            Decision Tree 평가 시작 / Next: DT Evaluation
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </Link>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        다음 단계: 각 표준 요구사항에 대해 Decision Tree 평가를 진행합니다.
        <br />
        Next: run the Decision Tree evaluation for each requirement.
      </p>
    </div>
  );
}

function safeJson(s: string): Record<string, string> {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}
