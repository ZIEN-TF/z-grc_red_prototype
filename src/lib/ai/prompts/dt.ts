// Decision Tree AI inference for a single requirement. Given the project's
// attachments + screening answers + asset inventory + the requirement spec
// (nodes, current matching iterations), the model walks the DT for each
// iteration and returns yes/no for each node it traverses, plus a one-line
// reasoning per node so the reviewer can sanity-check.

import type { DTRequirement } from "@/lib/decision-trees";
import { SCREENING_QUESTIONS } from "@/lib/screening-questions";

export type DTAIResult = {
  iterations: Array<{
    assetKey: string; // "__global__" or asset id
    answers: Array<{
      nodeId: string;
      answer: "yes" | "no" | "na";
      reasoning: string;
    }>;
  }>;
};

export const DT_SYSTEM_PROMPT = `당신은 EN 18031 Decision Tree 평가를 보조하는 사이버 보안 컨설턴트입니다.
주어진 요구사항의 Decision Tree를 각 평가 단위(자산 또는 기기 전체)에 대해 walk하면서 yes/no로 답하세요.

규칙:
1. **DT 노드 순회 규칙**: 항상 rootNodeId부터 시작합니다. 노드의 답변에 따라 (a) yes 분기 또는 (b) no 분기로 진행합니다. 분기가 다른 노드(goto)면 그 노드를 다음에 답하고, 결과(pass/fail/not_applicable)면 그 iteration 종료. 도달하지 못한 노드는 답변하지 마세요.
   - **na 답변**: 해당 질문 자체가 이 자산·기기에 전혀 해당되지 않을 때만 "na"로 답하세요. na를 답하면 그 iteration은 즉시 NOT APPLICABLE로 종료됩니다. yes/no로 판단 가능하면 na를 쓰지 말고 yes/no를 우선하세요. (na 남용 금지)
2. **보수적·안전적 답변**: 정보가 부족할 때는 "사용자가 점검해야 한다는 뜻으로" 답변을 어떻게 할지 고민하세요. 일반적으로 RED 자가평가에서는 (a) 메커니즘 적용성을 묻는 질문 → 적용된다고 가정하고 yes, (b) 실제 구현·동작·강도를 묻는 질문 → 충분히 검증되지 않은 경우 보수적으로 fail에 가까운 답을 주세요. 단, 첨부 파일·이전 답변에 명확한 근거가 있다면 그에 따릅니다.
3. **이전 단계 정합성**: 스크리닝 답변·자산 인벤토리와 모순되지 않게 답하세요. 예: 스크리닝에서 B8(암호 키)=yes, 자산에 type=key가 있으면 CCK 관련 DN-1(편차)에는 통상 no, DN-2(112비트 강도)에는 매뉴얼 정보에 따라.
4. reasoning은 1~2문장 한국어. "{근거 + 어떻게 도출}". 사용자가 검수해 다른 답으로 바꿀지 결정할 수 있도록 핵심 정보 + 판단 근거를 적으세요.
5. 모든 iteration에 대해 답하세요. 누락 금지.`;

// Build a textual description of the DT structure so the model can walk it.
function describeNodes(req: DTRequirement): string {
  return Object.values(req.nodes)
    .map((n) => {
      const yesBranch =
        "outcome" in n.yes
          ? `→ 결과: ${n.yes.outcome.toUpperCase()}`
          : `→ goto: ${n.yes.goto}`;
      const noBranch =
        "outcome" in n.no
          ? `→ 결과: ${n.no.outcome.toUpperCase()}`
          : `→ goto: ${n.no.goto}`;
      const hint = n.hint_ko ? `\n   힌트: ${n.hint_ko}` : "";
      return `### ${n.id}: ${n.text_ko}${hint}
   - YES ${yesBranch}
   - NO  ${noBranch}`;
    })
    .join("\n\n");
}

export function buildDTUserPrompt(opts: {
  project: {
    name: string;
    manufacturer: string;
    productType: string | null;
    productDescription: string | null;
  };
  requirement: DTRequirement;
  iterations: Array<{
    assetKey: string; // "__global__" | asset id
    label: string; // user-visible label for the model context
    metadata: Record<string, string>;
  }>;
  screeningAnswers: Record<string, "yes" | "no">;
  assetSummary: string; // pre-formatted summary of asset inventory
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

  const iterationList = opts.iterations
    .map((it) => {
      const meta = Object.entries(it.metadata)
        .map(([k, v]) => `   - ${k}: ${v}`)
        .join("\n");
      return `- assetKey="${it.assetKey}" — ${it.label}${meta ? "\n" + meta : ""}`;
    })
    .join("\n");

  return `다음 요구사항을 각 평가 단위(아래 iterations)에 대해 Decision Tree를 walk하면서 답하세요.

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

=== Decision Tree 구조 ===
시작 노드: ${opts.requirement.rootNodeId}

${describeNodes(opts.requirement)}

=== 평가 단위 (iterations) ===
${iterationList}

각 iteration마다 rootNodeId부터 시작해서 DT를 따라가며 도달한 모든 노드에 yes/no + reasoning을 반환하세요.
도달하지 않은 노드(다른 분기)는 절대 포함하지 마세요. 결과(pass/fail/not_applicable)에 도달하면 그 iteration의 답변 시퀀스가 끝납니다.`;
}

// Build a strict JSON Schema with enums of valid assetKeys + nodeIds for this
// specific requirement. This prevents the model from inventing IDs.
export function buildDTJsonSchema(
  requirement: DTRequirement,
  validAssetKeys: string[],
): Record<string, unknown> {
  const nodeIds = Object.keys(requirement.nodes);
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
            answers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  nodeId: { type: "string", enum: nodeIds },
                  answer: { type: "string", enum: ["yes", "no", "na"] },
                  reasoning: { type: "string" },
                },
                required: ["nodeId", "answer", "reasoning"],
              },
            },
          },
          required: ["assetKey", "answers"],
        },
      },
    },
    required: ["iterations"],
  };
}
