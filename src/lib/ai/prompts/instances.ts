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
주어진 제품·첨부 파일·이전 단계 결과를 근거로 다음 세 가지를 정확히 식별하세요.

━━━ 1) ACM (접근 통제 메커니즘) ━━━
ACM은 "**무엇인가에 대한 접근을 통제하는 게이트**"입니다. 통신 흐름이 아닙니다.
✅ ACM 예시 (이런 게 ACM):
   - "모바일 앱 → 클라우드 계정 로그인" (이메일/비밀번호 또는 OAuth 검증)
   - "디바이스 → 클라우드 MQTTS mTLS" (X.509 디바이스 인증서 검증)
   - "로컬 웹 UI 관리자 로그인" (계정 세션 검증)
   - "관리자 시리얼 콘솔 접근"
   - "OCPP backend 인증"
   - "공유 사용자 RBAC 권한 검증"
❌ ACM이 아닌 것 (절대 ACM으로 등록하지 마세요):
   - "카메라 → 클라우드 통신" (이건 데이터 흐름이지 접근 통제 게이트가 아님)
   - "MQTTS 8883 outbound" (이건 네트워크 서비스)
   - "HTTPS API" (이건 통신 채널)
   ※ "접근을 누군가 시도할 때, 거부할 수 있는가?"가 핵심. 단순 통신 채널은 ACM 아님.

ACM 등록 규칙:
- 통상 2~5개. 외부에서 접근 가능한 모든 보호 자원에 대한 ACM 필요.
- 인터페이스 플래그 정확히 체크:
  • interface_network=yes — 네트워크 통해 접근 (mTLS, JWT 검증, API 키 등)
  • interface_user=yes — 사용자가 직접 접근 (앱 로그인, 웹 UI, 로컬 콘솔)
  • interface_machine=yes — 머신·머신 자동 접근 (예: OCPP 디바이스, 클라우드 백엔드 인증)
  • 하나의 ACM이 여러 플래그를 가질 수 있음 (예: 앱 로그인 = network + user 둘 다 yes)

━━━ 2) Authenticator (인증자) ━━━
**각 ACM마다 최소 1개 이상의 인증자가 반드시 존재해야 합니다.** 인증 없이 통과하는 ACM은 ACM이 아니므로 본 단계에서 등록하지 않습니다.

규칙:
- 각 ACM마다 1~3개 인증자.
- authType 선택지: password, pin, biometric, certificate, network_trust, other
- authType="password"이면 **passwordSubtype을 반드시 채우세요**. 빈 문자열은 금지:
  • factory_default — 출고 시 고정 비밀번호가 들어있고 사용자가 받자마자 변경 강제 안 됨
  • user_set — 사용자가 등록·최초 사용 시 직접 설정 (대부분의 IoT 제품은 이쪽)
  • third_party — 외부 IdP/OAuth가 비밀번호를 관리 (예: Google·Apple Sign-In)
  • none — 비밀번호를 쓰지 않음 (사실상 authType≠password와 동일)
- 일반 사용자가 비밀번호를 직접 설정하는 IoT/홈 기기는 거의 항상 "user_set" 입니다.
- authType≠password이면 passwordSubtype은 빈 문자열 "" 로 두세요.
- acmName은 acms 배열 name과 **정확히 일치** (대소문자·공백 포함). 서버가 이걸로 부모 ACM을 매칭합니다.

AUM-5/6 평가 활성화 조건 (필수 숙지):
- AUM-5-1: 인증자가 password + factory_default일 때 평가
- AUM-5-2: 인증자가 password + user_set (third_party·none 제외)일 때 평가
- AUM-6: 인증자가 password + (factory_default 또는 user_set, third_party 제외)일 때 평가
→ 사용자가 비밀번호 변경 가능한 제품이면 user_set으로 등록해야 AUM-5-2/6이 평가됩니다.

━━━ 3) SUM (업데이트 메커니즘) ━━━
펌웨어·소프트웨어 업데이트 능력이 있으면 메커니즘마다 1개씩 등록.
예: "OTA 펌웨어 업데이트", "서명된 이미지 업데이트", "부분 업데이트 (ML 모델·설정)".
업데이트 기능이 전혀 없으면 빈 배열.

━━━ 일반 원칙 ━━━
정보가 부족해도 무선기기·홈 카메라·EV 충전기·네트워크 장비 등 통상적 보안 아키텍처를 따라 추론하세요. EN 18031은 "있을 법한 모든 인증 채널·업데이트 채널"을 평가하는 게 안전합니다.`;

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
