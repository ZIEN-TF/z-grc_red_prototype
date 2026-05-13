// Asset inventory AI inference — given the project's attachments, the model
// proposes a list of assets across the kinds applicable to the project's
// applicable EN 18031 standards. Each asset gets a kind, name, description,
// and metadata key/value pairs that map onto the AssetKind's schema.

import type { AssetKindConfig } from "@/lib/asset-kinds";
import { SCREENING_QUESTIONS } from "@/lib/screening-questions";

export type AssetAIResult = {
  assets: Array<{
    kind: string;
    name: string;
    description: string;
    metadata: Array<{ key: string; value: string }>;
  }>;
};

export const ASSETS_SYSTEM_PROMPT = `당신은 EN 18031 자산 인벤토리 작성을 보조하는 사이버 보안 컨설턴트입니다.
첨부된 제품 문서를 처음부터 끝까지 꼼꼼히 읽고, 문서에 언급된 모든 보안·네트워크·개인정보 관련 요소를 빠짐없이 자산으로 등록하세요.

━━━ 자산 종류별 역할 구분 (반드시 숙지) ━━━
• network_service : 기기가 사용하거나 노출하는 **프로토콜·포트·방향** (HTTPS/443 아웃바운드, RTSP/554 인바운드 등). "어떻게" 통신하는가.
• network_asset   : network_service로 접근되는 **기기 측 자원·기능 그 자체** (영상 스트리밍 기능, 원격 제어 수신 기능, 로컬 웹 관리 UI, TCP/OCPP 연결 자원, 네트워크 파라미터 등). "무엇이" 보호받아야 하는가. RLM 평가의 핵심 입력.
• data_flow       : 기기가 통신하는 **상대방과 목적** (기기→클라우드: 영상 전송, 기기→OTA 서버: 펌웨어 다운로드 등). "누구에게 무엇을" 전달하는가.

⚠️ network_service에 등록했다고 network_asset을 생략하면 안 됩니다. 같은 통신이라도 세 가지를 **모두 각각 등록**해야 합니다.
예시 — 영상 스트리밍 하나를 세 가지로 등록:
  · network_service → "RTSP over TLS" (프로토콜 RTSP, 포트 554, 방향: 수신)
  · network_asset   → "라이브 영상 스트리밍 기능" (기기가 노출하는 RTSP 스트림 자원, nature: function)
  · data_flow       → "기기→앱: 영상 스트림 전송" (peer: 모바일 앱, 목적: 실시간 영상)

━━━ 문서 읽기 원칙 ━━━
1. **문서의 모든 섹션을 순서대로 검토하세요.**
   - 포트/프로토콜 목록 → 각 항목이 network_service **및** data_flow 후보 (같은 통신도 둘 다 등록)
   - 네트워크 구성도·아키텍처 → **기기가 노출하는** 스트림·UI·제어 채널·파라미터마다 network_asset 후보 (외부 서버·클라우드는 data_flow로 등록)
   - 암호화 섹션 → 언급된 키·인증서·알고리즘마다 security_asset 후보
   - 인증 섹션 → 비밀번호·토큰·인증서가 security_asset 후보
   - 하드웨어 섹션 → 물리 포트마다 physical_interface 후보
   - 개인정보 섹션 → 수집 데이터 항목마다 privacy_asset 후보
     ※ sensitivity 분류 기준: 건강·생체인식·아동 관련 데이터만 "sensitive", 영상·위치·계정·기기정보 등은 "general"
   - 펌웨어/업데이트 섹션 → firmware_image, OTA 채널이 각각 후보

2. **같은 종류라도 목적이 다르면 별도 자산으로 등록하세요.**
   예: "AES 데이터 암호화 키(DEK)"와 "AES 영상 암호화 키(세션키)"는 별개 항목.
   예: "HTTPS API 채널"과 "HTTPS OTA 채널"은 별개 network_service.

3. **문서에 명시되지 않았더라도, 문서의 내용에서 논리적으로 존재가 확인되는 자산은 포함하세요.**
   예: TLS 통신이 언급되면 → TLS 클라이언트 인증서 + 개인키가 존재하는 것
   예: OTA 서명 검증이 언급되면 → OTA 서명 검증 키가 존재하는 것
   예: Secure Element 언급 → 거기에 저장된 키들이 존재하는 것

4. **스크리닝 답변과 정합성을 유지하세요.**
   B6(RLM)=yes → network_asset이 반드시 있어야 함 (네트워크 장비가 아닌 기기도 동일)
   B8(암호 키)=yes → type=key인 security_asset이 반드시 있어야 함
   B3(OTA)=yes → type=firmware_image인 security_asset이 반드시 있어야 함
   B11(로그)=yes → type=audit_log인 security_asset이 반드시 있어야 함
   A3(개인정보)=yes → privacy_asset이 반드시 있어야 함

5. **없는 것은 만들지 마세요.** 결제 기능이 없으면 financial_asset 없음.

6. **metadata**: 각 kind에 정의된 필드명·옵션 value만 사용. 불확실한 select 필드는
   가장 일반적인 값으로 추정. 잘못된 값보다 누락이 안전.

7. **name**: 짧고 식별력 있게 (한국어 또는 한/영 병기).
   **description**: 근거 문서와 섹션을 명시 ("암호화_사양서 §3.1 참조" 또는 "TLS 통신 구성에서 추론").`;

export function buildAssetsUserPrompt(
  project: {
    name: string;
    manufacturer: string;
    productType: string | null;
    productDescription: string | null;
  },
  applicableKinds: AssetKindConfig[],
  screeningAnswers: Record<string, "yes" | "no">,
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

  const kindsSpec = applicableKinds
    .map((k) => {
      const fields = k.metadataFields
        .map((f) => {
          if (f.type === "select" && f.options) {
            const opts = f.options
              .map((o) => `      - ${o.value}: ${o.label_ko}`)
              .join("\n");
            return `   • ${f.name} (select)${f.required ? " *필수*" : ""}:\n${opts}`;
          }
          return `   • ${f.name} (${f.type})${f.required ? " *필수*" : ""}`;
        })
        .join("\n");
      return `### kind="${k.kind}" — ${k.title_ko}
${k.description_ko}
필드:
${fields || "   (메타데이터 없음)"}`;
    })
    .join("\n\n");

  // Project's screening answers — used to keep the inferred inventory
  // consistent with what the user already confirmed about the product (e.g.,
  // B8=yes implies CCK keys exist).
  const screeningContext =
    Object.keys(screeningAnswers).length === 0
      ? "(스크리닝 답변 없음)"
      : SCREENING_QUESTIONS.filter((q) => screeningAnswers[q.id])
          .map(
            (q) =>
              `- [${q.id}] ${q.text_ko} → ${screeningAnswers[q.id]?.toUpperCase()}`,
          )
          .join("\n");

  return `다음 제품 정보·첨부 파일·스크리닝 답변을 근거로 자산 인벤토리 항목을 빠짐없이 열거하세요.

=== 제품 정보 ===
${productInfo}

=== 이전 단계: 스크리닝 답변 (사용자 검수 완료) ===
${screeningContext}

=== 등록 가능한 자산 종류 ===
${kindsSpec}

【출력 전 자가 점검 — 첨부 문서를 다시 훑으며 확인하세요】
□ 기기가 통신하는 서버·브로커·엔드포인트마다 network_asset이 등록됐는가?
□ 포트·프로토콜 목록에 나온 항목들이 network_service / data_flow에 각각 등록됐는가?
□ 암호화 섹션에 언급된 키·인증서 각각이 별도 security_asset으로 등록됐는가?
□ 물리 인터페이스 섹션에 나온 포트들이 physical_interface에 등록됐는가?
□ 개인정보 수집 항목들이 privacy_asset에 모두 등록됐는가?
□ privacy_asset의 sensitivity는 건강·생체·아동 데이터만 "sensitive", 나머지는 "general"로 분류했는가?
□ 같은 종류의 자산을 하나로 묶지는 않았는가?

각 자산은 { kind, name, description, metadata: [{ key, value }, ...] } 형태로 반환하세요.
metadata.key는 위 정의된 필드 이름과 정확히 일치해야 하고, select 필드의 value는 옵션 value 중 하나여야 합니다.`;
}

// Schema is non-strict (metadata is freeform array) — we validate the kind +
// metadata against the actual AssetKindConfig server-side after the call.
export const ASSETS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          metadata: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                key: { type: "string" },
                value: { type: "string" },
              },
              required: ["key", "value"],
            },
          },
        },
        required: ["kind", "name", "description", "metadata"],
      },
    },
  },
  required: ["assets"],
} as const;
