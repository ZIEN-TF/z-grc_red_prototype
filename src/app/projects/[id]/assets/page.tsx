import Link from "next/link";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  ASSET_ONLY_KINDS,
  applicableAssetKinds,
} from "@/lib/asset-kinds";
import type { StandardId } from "@/lib/mechanisms";
import { AssetSection } from "./asset-section";
import { CSVImportDialog } from "./csv-import-dialog";
import { LockedBanner } from "../locked-banner";
import { AIFillAssetsButton } from "./ai-fill-assets-button";
import { AssetsAIReviewBanner } from "./assets-ai-review-banner";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      assets: { orderBy: { createdAt: "asc" } },
      attachments: { select: { id: true } },
    },
  });
  if (!project) notFound();

  // Determine applicable standards. If screening incomplete, show everything.
  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);
  const ASSET_KINDS = project.screeningComplete && applicableStandards.length > 0
    ? applicableAssetKinds(applicableStandards)
    : ASSET_ONLY_KINDS;

  const countsByKind = new Map<string, number>();
  for (const a of project.assets) {
    countsByKind.set(a.kind, (countsByKind.get(a.kind) ?? 0) + 1);
  }

  const aiGeneratedAssets = project.assets.filter(
    (a) => a.aiGenerated && !a.userReviewed,
  );
  const aiGeneratedIds = aiGeneratedAssets.map((a) => a.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/projects/${project.id}/result`}>
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            스크리닝 결과 / Screening Result
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          자산 인벤토리
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Asset Inventory
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          제품: <span className="font-medium text-foreground">{project.name}</span>
          {" · "}
          {project.manufacturer}
        </p>
      </div>

      <LockedBanner
        projectId={project.id}
        finalizedAt={project.finalizedAt}
        finalizedBy={project.finalizedBy}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <AIFillAssetsButton
          projectId={project.id}
          hasAttachments={project.attachments.length > 0}
          hasExisting={project.assets.length > 0}
          disabled={project.finalizedAt !== null}
        />
        <CSVImportDialog
          projectId={project.id}
          disabled={project.finalizedAt !== null}
        />
      </div>

      <AssetsAIReviewBanner
        projectId={project.id}
        count={aiGeneratedIds.length}
        assetIds={aiGeneratedIds}
      />

      <Card className="border-accent bg-accent/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="size-4 text-primary" />
            왜 자산 인벤토리가 필요한가요? / Why do we need this?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Decision Tree 평가(예: ACM DT는 각 자산별 접근통제 여부를 판정, SCM DT는 각 데이터 흐름별 보호 방식을 판정)는 여기 등록된 자산들을 대상으로 수행됩니다. 빠진 항목이 있으면 평가 결과가 불완전해질 수 있습니다.
          <br />
          Decision Tree evaluation (e.g., ACM per asset, SCM per data flow) is performed over the assets registered here. Missing entries may lead to incomplete results.
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {ASSET_KINDS.map((k) => (
          <a
            key={k.kind}
            href={`#section-${k.kind}`}
            className="group rounded-lg border bg-card px-3 py-2 transition hover:border-primary/50 hover:bg-accent/40"
          >
            <div className="truncate text-xs text-muted-foreground">
              {k.title_en}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">
                {countsByKind.get(k.kind) ?? 0}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {k.title_ko}
              </span>
            </div>
          </a>
        ))}
      </div>

      {ASSET_KINDS.map((kind) => (
        <div key={kind.kind} id={`section-${kind.kind}`} className="scroll-mt-20">
          <AssetSection
            projectId={project.id}
            kindConfig={kind}
            assets={project.assets
              .filter((a) => a.kind === kind.kind)
              .map((a) => ({
                id: a.id,
                name: a.name,
                description: a.description,
                metadata: safeJson(a.metadata),
                createdAt: a.createdAt.toISOString(),
              }))}
            aiGeneratedIds={aiGeneratedIds}
          />
        </div>
      ))}

      <div className="flex items-center justify-between gap-4 py-4">
        <Link href={`/projects/${project.id}/result`}>
          <Button variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            스크리닝 결과로 / Back to Screening Result
          </Button>
        </Link>
        <Link href={`/projects/${project.id}/assets/review`}>
          <Button>
            검토 / Review
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </Link>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        검토 페이지에서 등록 내용을 확인하고 Decision Tree 평가로 진행합니다.
        <br />
        On the review page, confirm your entries before proceeding to the Decision Tree step.
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
