import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Share2,
  Globe,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateShareTokenButton } from "./create-share-token-button";
import { RevokeShareTokenButton } from "./revoke-share-token-button";
import { CopyLinkButton } from "./copy-link-button";

export default async function ShareManagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      userId: true,
      shareTokens: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!project) notFound();
  if (session.role !== "consultant" && project.userId !== session.userId) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/projects/${id}`}>
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            개요로 / Back
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          공유 링크 관리
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Share Links
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {project.name} · {project.manufacturer}
        </p>
      </div>

      <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10">
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            <Globe className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              공유 링크를 가진 누구나 이 프로젝트를{" "}
              <strong>읽기 전용</strong>으로 볼 수 있습니다.
              링크를 삭제하면 즉시 접근이 차단됩니다.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                활성 공유 링크 / Active Links
              </CardTitle>
              <CardDescription>
                {project.shareTokens.length === 0
                  ? "생성된 공유 링크가 없습니다."
                  : `${project.shareTokens.length}개 링크 활성`}
              </CardDescription>
            </div>
            <CreateShareTokenButton projectId={id} />
          </div>
        </CardHeader>
        <CardContent>
          {project.shareTokens.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center">
              <Share2 className="mx-auto mb-3 size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                공유 링크가 없습니다. 새 링크를 생성하세요.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {project.shareTokens.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-start gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <code className="block truncate rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      /share/{t.token}
                    </code>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      생성:{" "}
                      {t.createdAt.toLocaleDateString("ko-KR", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <CopyLinkButton token={t.token} />
                    <RevokeShareTokenButton tokenId={t.id} projectId={id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
