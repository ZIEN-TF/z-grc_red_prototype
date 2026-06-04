// Mock AI fills for testing the collaboration workflow WITHOUT calling the
// Claude API. Enable with the env flag AI_MOCK=1 (or "true"). Each mock segment
// inserts a little plausible-looking placeholder data so the downstream pages
// (assets / DT / remediation / assessment) aren't empty, then run-pipeline.ts
// advances the phase + sends notifications exactly as in a real run.
//
// This is test-only scaffolding — gated entirely behind isAiMock(); real runs
// are unaffected.

import { prisma } from "@/lib/prisma";
import { DT_REQUIREMENTS, assessmentsFor } from "@/lib/decision-trees";

export function isAiMock(): boolean {
  return process.env.AI_MOCK === "1" || process.env.AI_MOCK === "true";
}

// A few fake assets so the assets page has content.
export async function mockAssets(projectId: string): Promise<void> {
  const now = new Date();
  const fakes: Array<{ kind: string; name: string }> = [
    { kind: "network_interface", name: "(테스트) 이더넷 인터페이스" },
    { kind: "network_service", name: "(테스트) HTTP 관리 서비스" },
    { kind: "security_asset", name: "(테스트) 펌웨어 이미지" },
  ];
  for (const f of fakes) {
    const exists = await prisma.asset.findFirst({
      where: { projectId, name: f.name },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.asset.create({
      data: {
        projectId,
        kind: f.kind,
        name: f.name,
        metadata: "{}",
        aiGenerated: true,
        aiGeneratedAt: now,
      },
    });
  }
}

// Fake DT answers + a couple FAIL remediations so the DT and remediation
// screens have content to exercise.
export async function mockDt(projectId: string): Promise<void> {
  const now = new Date();
  const reqs = DT_REQUIREMENTS.slice(0, 3);

  for (const req of reqs) {
    try {
      const existing = await prisma.dTAnswer.findFirst({
        where: { projectId, requirementId: req.id, nodeId: req.rootNodeId },
        select: { id: true },
      });
      if (!existing) {
        await prisma.dTAnswer.create({
          data: {
            projectId,
            assetId: null,
            mechanismCode: req.mechanismCode,
            requirementId: req.id,
            nodeId: req.rootNodeId,
            answer: "no",
            notes: "(테스트용 가상 답변)",
            aiGenerated: true,
            aiGeneratedAt: now,
          },
        });
      }
    } catch {
      /* ignore — best-effort placeholder */
    }
  }

  // Two fake remediations (treated as FAIL) for the remediation review screen.
  for (const req of reqs.slice(0, 2)) {
    const exists = await prisma.dTRemediation.findFirst({
      where: { projectId, assetId: null, requirementId: req.id },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.dTRemediation.create({
      data: {
        projectId,
        assetId: null,
        requirementId: req.id,
        remediationText:
          `(테스트용 가상 조치 방안) ${req.title_ko} 요구사항이 미충족 상태입니다. ` +
          "관련 설정/구현을 보완하고 증빙 문서를 갱신하세요.",
        aiGenerated: true,
        aiGeneratedAt: now,
      },
    });
  }
}

// Fake assessment rows — testMethod filled, testResult/verdict left for the
// human consultant (mirrors the real testMethod-only behavior).
export async function mockAssessment(projectId: string): Promise<void> {
  const now = new Date();
  const reqs = DT_REQUIREMENTS.filter((r) => assessmentsFor(r.id).length > 0).slice(0, 3);
  for (const req of reqs) {
    for (const t of assessmentsFor(req.id)) {
      const exists = await prisma.dTAssessment.findFirst({
        where: { projectId, assetId: null, requirementId: req.id, assessmentType: t },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.dTAssessment.create({
        data: {
          projectId,
          assetId: null,
          requirementId: req.id,
          assessmentType: t,
          testMethod: `(테스트용 가상 테스트 방법) ${req.title_ko} 충족 여부 확인 절차.`,
          testResult: "",
          aiGenerated: true,
          aiGeneratedAt: now,
        },
      });
    }
  }
}
