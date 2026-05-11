// Per-requirement evidence (Required Information) fill. Given the DT path the
// user took plus all prior context, the model writes a 1-2 sentence draft for
// each applicable evidenceField (E.Info / E.Just / etc) per iteration so the
// reviewer has a starting point.

import type { DTRequirement, EvidenceField } from "@/lib/decision-trees";
import { SCREENING_QUESTIONS } from "@/lib/screening-questions";

export type EvidenceAIResult = {
  iterations: Array<{
    assetKey: string; // "__global__" or asset id
    fields: Array<{
      fieldId: string;
      value: string;
    }>;
  }>;
};

export const EVIDENCE_SYSTEM_PROMPT = `당신은 EN 18031 자가평가의 Required Information(증빙 정보)을 작성하는 사이버 보안 컨설턴트입니다.
주어진 요구사항·DT 답변·자산 메타데이터·첨부 파일을 근거로, 각 평가 단위의 모든 적용 가능한 evidence 필드에 1~3문장 한국어 초안을 채우세요.

규칙:
1. **fieldId별 prompt(질문)에 직접 답변**하세요. 추측이 필요한 부분은 "추정 - 매뉴얼에 따르면 ..." 같이 근거와 함께 적어 사용자가 빠르게 검증·수정할 수 있게 합니다.
2. **DT 답변과 정합**: 사용자가 yes로 답한 노드 → 그 분기에 해당하는 정당화·구현 설명. no로 답한 노드 → 그 분기에 해당하는 사유.
3. **showPathAbove 또는 Justification 필드 (id가 E.Just.DT.~ 로 시작)**: 사용자가 walk한 DT 경로를 1~2문장으로 정당화. 노드 답변의 reasoning을 종합해서 "DN-1=yes(...), DN-2=no(...)이므로 PASS/FAIL/NA로 결정" 식.
4. 자산 메타데이터(예: protocol, type, sensitivity)를 적극 인용해 자산별 답변을 차별화하세요. 모든 자산에 같은 답변을 복붙하지 마세요.
5. 정보가 부족해 정확한 답을 모르겠다면, "구체적 구현은 사용자가 확인 필요" 같이 짧게 적고 사용자가 채우게 두세요. 추측으로 채우는 것보다 짧고 솔직한 게 안전합니다.
6. 평가 결과 자체(PASS/FAIL/NA)를 직접 단정하지 말고, 사실 기술 + 근거 인용에 집중하세요.`;

// Build the "DT path" + "fields applicable" context for one iteration.
function describeIteration(opts: {
  requirement: DTRequirement;
  iteration: {
    assetKey: string;
    label: string;
    metadata: Record<string, string>;
    answeredPath: Array<{ nodeId: string; answer: "yes" | "no" }>;
  };
  applicableFields: EvidenceField[];
}): string {
  const meta = Object.entries(opts.iteration.metadata)
    .filter(([, v]) => v && v !== "")
    .map(([k, v]) => `   - ${k}: ${v}`)
    .join("\n");

  const path =
    opts.iteration.answeredPath.length === 0
      ? "(아직 DT 답변 없음)"
      : opts.iteration.answeredPath
          .map((p) => {
            const node = opts.requirement.nodes[p.nodeId];
            return `   - [${p.nodeId}] ${node?.text_ko ?? p.nodeId} → ${p.answer.toUpperCase()}`;
          })
          .join("\n");

  const fields = opts.applicableFields
    .map((f) => {
      const grp = f.group_ko ? ` [${f.group_ko}]` : "";
      const req = f.required ? " *필수*" : "";
      return `   • fieldId="${f.id}"${grp}${req}\n     prompt: ${f.prompt_ko}`;
    })
    .join("\n");

  return `### 평가 단위 assetKey="${opts.iteration.assetKey}" — ${opts.iteration.label}
자산 메타데이터:
${meta || "   (없음)"}

DT 답변 경로:
${path}

채워야 할 필드:
${fields}`;
}

export function buildEvidenceUserPrompt(opts: {
  project: {
    name: string;
    manufacturer: string;
    productType: string | null;
    productDescription: string | null;
  };
  requirement: DTRequirement;
  iterations: Array<{
    assetKey: string;
    label: string;
    metadata: Record<string, string>;
    answeredPath: Array<{ nodeId: string; answer: "yes" | "no" }>;
    applicableFields: EvidenceField[];
  }>;
  screeningAnswers: Record<string, "yes" | "no">;
  assetSummary: string;
}): string {
  const productInfo = [
    `제품명: ${opts.project.name}`,
    `제조사: ${opts.project.manufacturer}`,
    opts.project.productType ? `제품 유형: ${opts.project.productType}` : null,
    opts.project.productDescription
      ? `제품 설명:\n${opts.project.productDescription}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const screeningContext =
    Object.keys(opts.screeningAnswers).length === 0
      ? "(스크리닝 답변 없음)"
      : SCREENING_QUESTIONS.filter((q) => opts.screeningAnswers[q.id])
          .map(
            (q) =>
              `- [${q.id}] ${q.text_ko} → ${opts.screeningAnswers[q.id]?.toUpperCase()}`,
          )
          .join("\n");

  const iterationBlocks = opts.iterations
    .map((it) =>
      describeIteration({
        requirement: opts.requirement,
        iteration: it,
        applicableFields: it.applicableFields,
      }),
    )
    .join("\n\n");

  return `다음 요구사항의 증빙 정보(Required Information)를 각 평가 단위별로 채우세요.

=== 제품 정보 ===
${productInfo}

=== 이전 단계: 스크리닝 답변 ===
${screeningContext}

=== 이전 단계: 등록된 자산 인벤토리 ===
${opts.assetSummary || "(자산 없음)"}

=== 요구사항 ===
ID: ${opts.requirement.id}
조항: ${opts.requirement.clause}
제목: ${opts.requirement.title_ko}
원문 요구사항:
${opts.requirement.requirementText_ko}

=== 평가 단위별 채울 필드 ===
${iterationBlocks}

각 iteration·field에 1~3문장 한국어 답변을 채우세요. 사용자가 검수·수정할 수 있는 초안 수준이면 충분합니다.`;
}

// Build a strict JSON Schema with enums of valid assetKeys + fieldIds for
// this specific requirement-iteration set.
export function buildEvidenceJsonSchema(
  validAssetKeys: string[],
  validFieldIds: string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      iterations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            assetKey: { type: "string", enum: validAssetKeys },
            fields: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  fieldId: { type: "string", enum: validFieldIds },
                  value: { type: "string" },
                },
                required: ["fieldId", "value"],
              },
            },
          },
          required: ["assetKey", "fields"],
        },
      },
    },
    required: ["iterations"],
  };
}
