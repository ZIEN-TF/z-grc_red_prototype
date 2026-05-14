// Inline instance inference for the bulk DT AI fill flow:
//   - Access Control Mechanisms (acm_instance) — registered on the ACM-2 page
//   - Authenticators (authenticator_instance) — registered on the AUM-2 page
//   - Update Mechanisms (sum_instance) — iteration unit for SUM-2 / SUM-3
//
// These hidden asset kinds drive the iteration over which AUM/SUM DTs are
// evaluated, so they must exist before the DT walk. The bulk action calls
// this once when none of them have been registered yet.

import { SCREENING_QUESTIONS } from "@/lib/screening-questions";

export type InstancesAIResult = {
  acms: Array<{
    name: string;
    interfaceNetwork: boolean;
    interfaceUser: boolean;
    interfaceMachine: boolean;
    acmType: "rbac" | "dac" | "mac" | "other" | "";
  }>;
  authenticators: Array<{
    acmName: string; // matches one of acms[].name — server resolves to acm_id
    name: string;
    authType:
      | "password"
      | "pin"
      | "biometric"
      | "certificate"
      | "network_trust"
      | "other"
      | "";
    passwordSubtype:
      | "factory_default"
      | "user_set"
      | "third_party"
      | "none"
      | "";
  }>;
  // Each distinct update mechanism the device exposes. Examples: an OTA
  // firmware updater, a signed config-package installer, an in-band module
  // updater. Empty array if the device has no software update capability.
  sums: Array<{
    name: string;
  }>;
};

export const INSTANCES_SYSTEM_PROMPT = `당신은 EN 18031 자가평가의 접근 통제 메커니즘(ACM)·인증자(Authenticator)·업데이트 메커니즘(SUM)을 식별하는 컨설턴트입니다.
주어진 제품·첨부 파일·이전 단계 결과를 근거로:
1. 이 제품에 존재하는 모든 ACM (관리 채널·로그인·API 토큰 등)
2. 각 ACM에서 사용되는 인증자(authenticator)
3. 이 제품의 모든 소프트웨어/펌웨어 업데이트 메커니즘 (SUM-2/SUM-3 평가 단위)

규칙:
1. **ACM 추론**: 통상 1~3개. 예: "관리자 웹 UI 로그인", "OCPP backend 인증", "로컬 시리얼 콘솔". 인터페이스 플래그를 정확히 체크 (네트워크/사용자/머신).
2. **인증자 추론**: 각 ACM마다 1~3개의 인증자 (비밀번호, PIN, 인증서, 생체, 네트워크 신뢰). authType=password일 때만 passwordSubtype 채움. 그 외는 빈 문자열 ""로 두세요.
3. **AUM-5/6 평가 활성화 조건 인지**: AUM-5-1·AUM-6은 인증자가 비밀번호 + 공장 기본(factory_default)일 때, AUM-5-2·AUM-6은 비밀번호 + 사용자 설정(user_set)일 때 평가됩니다. 일반 사용자가 비밀번호를 변경할 수 있는 IoT/네트워크 기기는 보통 "user_set"이 맞고, 출고 시 고정 비밀번호가 설정되어 있으면 "factory_default" 추가 필요.
4. acmName은 acms 배열에 등록한 name과 정확히 일치해야 합니다 (서버가 이걸로 부모 ACM을 매칭).
5. **SUM 추론**: 펌웨어/소프트웨어 업데이트 능력이 있으면 메커니즘마다 1개씩 등록. 예: "OTA 펌웨어 업데이트", "서명된 이미지 업데이트", "부분 업데이트 (ML 모델·설정)". 업데이트 기능이 전혀 없으면 빈 배열.
6. 정보가 부족해도 무선기기·EV 충전기·네트워크 장비 등 통상적 보안 아키텍처를 따라 추론하세요. EN 18031은 "있을 법한 인증 채널·업데이트 채널"을 모두 평가하는 게 안전합니다.`;

export function buildInstancesUserPrompt(
  project: {
    name: string;
    manufacturer: string;
    productType: string | null;
    productDescription: string | null;
  },
  screeningAnswers: Record<string, "yes" | "no">,
  assetSummary: string,
): string {
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

  const screeningContext =
    Object.keys(screeningAnswers).length === 0
      ? "(스크리닝 답변 없음)"
      : SCREENING_QUESTIONS.filter((q) => screeningAnswers[q.id])
          .map(
            (q) =>
              `- [${q.id}] ${q.text_ko} → ${screeningAnswers[q.id]?.toUpperCase()}`,
          )
          .join("\n");

  return `다음 제품 정보·첨부 파일·이전 단계 결과를 근거로 ACM과 인증자를 식별하세요.

=== 제품 정보 ===
${productInfo}

=== 이전 단계: 스크리닝 답변 ===
${screeningContext}

=== 이전 단계: 등록된 자산 인벤토리 ===
${assetSummary || "(자산 없음)"}

=== 출력 형식 ===
{
  "acms": [{ name, interfaceNetwork, interfaceUser, interfaceMachine, acmType }],
  "authenticators": [{ acmName, name, authType, passwordSubtype }],
  "sums": [{ name }]
}

acmName은 위 acms[].name과 정확히 일치해야 합니다 (대소문자·공백 포함).
sums는 업데이트 메커니즘이 없으면 빈 배열 [] 로 두세요.`;
}

export const INSTANCES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    acms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          interfaceNetwork: { type: "boolean" },
          interfaceUser: { type: "boolean" },
          interfaceMachine: { type: "boolean" },
          acmType: {
            type: "string",
            enum: ["rbac", "dac", "mac", "other", ""],
          },
        },
        required: [
          "name",
          "interfaceNetwork",
          "interfaceUser",
          "interfaceMachine",
          "acmType",
        ],
      },
    },
    authenticators: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          acmName: { type: "string" },
          name: { type: "string" },
          authType: {
            type: "string",
            enum: [
              "password",
              "pin",
              "biometric",
              "certificate",
              "network_trust",
              "other",
              "",
            ],
          },
          passwordSubtype: {
            type: "string",
            enum: [
              "factory_default",
              "user_set",
              "third_party",
              "none",
              "",
            ],
          },
        },
        required: ["acmName", "name", "authType", "passwordSubtype"],
      },
    },
    sums: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  required: ["acms", "authenticators", "sums"],
} as const;
