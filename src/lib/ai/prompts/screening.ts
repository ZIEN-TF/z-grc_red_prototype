// Screening AI fill prompt — given the project's product info + uploaded
// attachments (manuals, architecture diagrams, etc.), the model answers each
// SCREENING_QUESTIONS item with yes/no and a one-sentence reasoning that the
// reviewer can use to verify/override.

import { SCREENING_QUESTIONS } from "@/lib/screening-questions";

export type ScreeningAIResult = {
  answers: Array<{
    questionId: string;
    answer: "yes" | "no";
    reasoning: string;
  }>;
};

export const SCREENING_SYSTEM_PROMPT = `당신은 EN 18031 (RED Article 3.3 (d)/(e)/(f)) 자가 평가를 보조하는 사이버 보안 컨설턴트입니다.
주어진 제품 정보와 첨부 파일(제품 매뉴얼·아키텍처 도식·사양서 등)을 근거로, 적용성 스크리닝 질문에 yes/no로 답하세요.

규칙:
1. 첨부 파일과 제품 설명에서 명확히 추론할 수 있는 사실만 사용하세요. 추측이 필요할 때는 보수적으로 판단하세요.
2. 정보가 부족하면 일반적인 RED 대상 무선기기의 디폴트 가정에 따라 답하되, reasoning에 "정보 부족 - {기본 가정}"을 명시하세요.
3. 각 질문의 hint(힌트)를 답변 기준으로 우선 고려하세요.
4. reasoning은 1~2문장 한국어로, 어떤 근거로 그 답을 도출했는지 명확히 적으세요. 사용자가 검수하기 위한 정보입니다.
5. 모든 질문에 빠짐없이 답하세요.`;

export function buildScreeningUserPrompt(project: {
  name: string;
  manufacturer: string;
  productType: string | null;
  productDescription: string | null;
}): string {
  const productInfo = [
    `제품명: ${project.name}`,
    `제조사: ${project.manufacturer}`,
    project.productType ? `제품 유형: ${project.productType}` : null,
    project.productDescription
      ? `제품 설명:\n${project.productDescription}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const questionList = SCREENING_QUESTIONS.map((q) => {
    const hint = q.hint_ko ? `\n   힌트: ${q.hint_ko}` : "";
    return `- [${q.id}] (섹션 ${q.section}) ${q.text_ko}${hint}`;
  }).join("\n");

  return `다음 제품 정보와 첨부 파일을 근거로 아래 스크리닝 질문에 답해 주세요.

=== 제품 정보 ===
${productInfo}

=== 스크리닝 질문 (총 ${SCREENING_QUESTIONS.length}개) ===
${questionList}

각 질문에 대해 questionId, answer (yes/no), reasoning (1~2문장 한국어)을 JSON으로 반환하세요.`;
}

// JSON Schema for OpenAI structured output. Enumerates the questionIds so the
// model can't invent new ones.
export const SCREENING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          questionId: {
            type: "string",
            enum: SCREENING_QUESTIONS.map((q) => q.id),
          },
          answer: { type: "string", enum: ["yes", "no"] },
          reasoning: { type: "string" },
        },
        required: ["questionId", "answer", "reasoning"],
      },
    },
  },
  required: ["answers"],
} as const;
