import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { requirementById } from "@/lib/decision-trees";
import { RemediationReview, type RemediationItem } from "./remediation-review";

export default async function RemediationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, phase: true },
  });
  if (!project) notFound();

  const rows = await prisma.dTRemediation.findMany({
    where: { projectId: id },
    include: { asset: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const items: RemediationItem[] = rows.map((r) => ({
    id: r.id,
    requirementId: r.requirementId,
    requirementTitle: requirementById(r.requirementId)?.title_ko ?? "",
    assetName: r.asset?.name ?? "기기 전체",
    remediationText: r.remediationText,
    actionStatus: r.actionStatus,
    customerNote: r.customerNote,
    responded: r.respondedAt !== null,
  }));

  // The customer can record responses only during their DT confirmation turn.
  const editable = session.role === "customer" && project.phase === "DT_CUSTOMER";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">조치 방안</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session.role === "customer"
            ? "부적합으로 판정된 항목의 조치 방안입니다. 각 항목의 조치 현황을 입력해 주세요."
            : "부적합 항목의 조치 방안과 고객의 조치 현황입니다."}
        </p>
      </div>
      <RemediationReview items={items} editable={editable} />
    </div>
  );
}
