import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Circle } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MECHANISMS, STANDARDS, type StandardId } from "@/lib/mechanisms";
import { AiPipelinePanel } from "./ai-pipeline-panel";
import { getAiPipelineStatus } from "@/app/ai-pipeline-actions";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  if (!project.screeningComplete) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              스크리닝이 아직 완료되지 않았습니다. / Screening is not complete yet.
            </p>
            <Link href={`/projects/${project.id}/screening`}>
              <Button className="mt-4">
                스크리닝 진행 / Go to Screening
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const applicableStandards: StandardId[] = [];
  if (project.applicable1) applicableStandards.push(1);
  if (project.applicable2) applicableStandards.push(2);
  if (project.applicable3) applicableStandards.push(3);

  const candidates = new Set<string>(
    JSON.parse(project.mechanismCandidates) as string[],
  );

  const firmwareCount = await prisma.projectAttachment.count({
    where: { projectId: id, kind: "firmware" },
  });
  const pipelineStatus = await getAiPipelineStatus(id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/">
          <Button variant="ghost" size="sm" className="-ml-3">
            <ArrowLeft className="mr-1 size-4" />
            홈으로 / Home
          </Button>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          스크리닝 결과
          <span className="ml-2 text-base font-medium text-muted-foreground">
            / Screening Result
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          제품: <span className="font-medium text-foreground">{project.name}</span>
          {" · "}
          {project.manufacturer}
        </p>
      </div>

      <AiPipelinePanel
        projectId={project.id}
        initial={pipelineStatus}
        hasFirmware={firmwareCount > 0}
        disabled={project.finalizedAt !== null}
      />

      {/* Applicable standards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            적용 대상 표준 / Applicable Standards
          </CardTitle>
          <CardDescription>
            스크리닝 응답에 따라 본 제품은 다음 표준에 해당합니다. /
            Based on your answers, the following standards apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {applicableStandards.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              해당되는 EN 18031 표준이 없습니다. 응답을 다시 확인하거나 본 기기가 평가 범위 밖일 수 있습니다.
              <br />
              No EN 18031 standard applies. Please review your answers or your device may be out of scope.
            </p>
          ) : (
            <ul className="space-y-2">
              {applicableStandards.map((s) => (
                <li
                  key={s}
                  className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
                >
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium">
                      {STANDARDS[s].name_ko}
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({STANDARDS[s].article})
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {STANDARDS[s].name_en}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Mechanism matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            메커니즘 적용 매트릭스 / Mechanism Applicability Matrix
          </CardTitle>
          <CardDescription>
            각 메커니즘이 어느 표준 범위에서 관련 있는지, 그리고 스크리닝 결과 후보로 선정되었는지 표시합니다.
            자세한 적용 여부는 이후 Decision Tree 단계에서 결정합니다.
            <br />
            Shows which mechanisms belong to each standard and whether they were flagged by screening. Final applicability is decided in the Decision Tree step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">코드 / Code</TableHead>
                  <TableHead>메커니즘 / Mechanism</TableHead>
                  <TableHead className="w-24 text-center">EN-1</TableHead>
                  <TableHead className="w-24 text-center">EN-2</TableHead>
                  <TableHead className="w-24 text-center">EN-3</TableHead>
                  <TableHead className="w-32 text-center">
                    후보 / Candidate
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MECHANISMS.map((m) => {
                  const isCandidate = candidates.has(m.code);
                  return (
                    <TableRow key={m.code}>
                      <TableCell className="font-mono text-xs">
                        {m.code}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{m.name_ko}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.name_en}
                        </div>
                      </TableCell>
                      {[1, 2, 3].map((s) => {
                        const belongs = m.standards.includes(s as StandardId);
                        const applies =
                          belongs &&
                          applicableStandards.includes(s as StandardId) &&
                          isCandidate;
                        return (
                          <TableCell key={s} className="text-center">
                            {applies ? (
                              <CheckCircle2 className="mx-auto size-4 text-primary" />
                            ) : belongs ? (
                              <Circle className="mx-auto size-4 text-muted-foreground/40" />
                            ) : (
                              <span className="text-muted-foreground/30">·</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center">
                        {isCandidate ? (
                          <Badge className="bg-primary/90">해당 / Yes</Badge>
                        ) : (
                          <Badge variant="outline">미해당 / No</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            <CheckCircle2 className="mr-1 inline size-3 text-primary" />
            적용 표준 × 메커니즘 &nbsp;·&nbsp;
            <Circle className="mr-1 inline size-3 text-muted-foreground/40" />
            표준에는 속하나 적용 대상 아님 &nbsp;·&nbsp; · 해당 없음
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4 py-4">
        <Link href={`/projects/${project.id}/screening`}>
          <Button variant="outline">
            스크리닝 수정 / Edit Screening
          </Button>
        </Link>
        <Link href={`/projects/${project.id}/assets`}>
          <Button>
            자산 인벤토리로 / Next: Asset Inventory
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </Link>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        다음 단계는 Decision Tree 엔진(메커니즘별 평가)입니다.
        <br />
        Next is the Decision Tree engine (per-mechanism evaluation).
      </p>
    </div>
  );
}
