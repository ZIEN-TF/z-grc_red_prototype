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
주어진 제품 정보·첨부 파일·이전 단계 스크리닝 결과를 근거로, 적용 가능한 자산 종류별로 자산 항목을 적극적으로 제안하세요.

규칙:
1. **적극적 추론**: 첨부 파일에 직접 언급되지 않더라도, 제품 카테고리상 통상적으로 존재하는 자산은 포함하세요. EN 18031 평가는 "있을 법한 모든 자산"을 식별해야 하므로 누락보다 포함이 안전합니다. 매뉴얼은 보통 사용자 관점이라 보안 내부 자산을 기술하지 않습니다 — 무선기기라면 거의 확실히 admin 비밀번호·TLS 인증서·펌웨어 이미지·노출된 관리 API가 존재합니다.
2. **종류별 추론 가이드 (가능한 한 모든 적용 종류에 1개 이상씩 채우세요)**:
   • security_asset: 관리자/유지보수 비밀번호 (type=credential), TLS·서명 키 (type=key), 디바이스 인증서 (type=certificate), 보안 설정값 (type=security_config), 펌웨어 이미지 (type=firmware_image), 부팅 키/시큐어 부트 (type=key) 등.
   • network_asset: 노출된 관리 API/웹 UI, 클라우드 텔레메트리·텔레컨트롤 채널, OCPP 등 외부 통신 엔드포인트, OTA 업데이트 채널 등.
   • privacy_asset: 사용자 계정·로그·세션, 위치, 사용 이력 등 개인정보 처리가 있을 때만.
   • financial_asset: 결제·거래·바우처 등 금전 흐름이 있을 때만.
   • network_interface: Wi-Fi·Ethernet·Bluetooth·셀룰러·Zigbee 등 실제 통신 인터페이스.
   • network_service: 제품이 노출하거나 사용하는 프로토콜 (HTTPS, MQTT, OCPP, SSH 등).
   • data_flow: 디바이스 ↔ 클라우드/서버, 디바이스 ↔ 모바일 앱, 디바이스 ↔ EV 등 통신 흐름.
   • physical_interface: USB·시리얼·JTAG·SD·디버그 핀 등 비통신 물리 포트.
3. **스크리닝 답변과의 정합성을 반드시 유지**하세요. 예: B8(암호 키)=yes면 security_asset에 type=key 1개 이상 필수, B6(보안 통신)=yes면 SCM 관련 데이터 흐름·통신 인터페이스 필수, B12(개인정보)=yes면 privacy_asset 필수 등.
4. 명백히 없는 자산 종류만 누락하세요. (예: 결제 기능 없으면 financial_asset 없음, 개인정보 처리 없으면 privacy_asset 없음, 충전기 등 EV 디바이스인데 OCPP 결제가 없으면 financial_asset 없음.)
5. metadata는 해당 kind에 정의된 필드 이름과 옵션 값(value)만 사용하세요. text 필드는 자유 입력. 정보가 없는 select 필드는 가장 일반적인 default 값을 추정해 채우되, 모르면 해당 필드를 누락하세요 (잘못된 값보다 누락이 안전).
6. name은 짧고 식별력 있는 한국어(또는 한/영 병기) 이름으로 작성. description은 1문장 설명, "추정 - {근거}" 또는 "매뉴얼 §X 참조" 같이 정보 출처를 적어 사용자가 검수하기 쉽게 합니다.`;

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

  return `다음 제품 정보·첨부 파일·스크리닝 답변을 근거로 자산 인벤토리 항목을 제안하세요.

=== 제품 정보 ===
${productInfo}

=== 이전 단계: 스크리닝 답변 (사용자 검수 완료) ===
${screeningContext}

=== 등록 가능한 자산 종류 ===
${kindsSpec}

각 자산은 { kind, name, description, metadata: [{ key, value }, ...] } 형태로 반환하세요.
metadata.key는 위 정의된 필드 이름과 정확히 일치해야 하고, select 필드의 value는 옵션 value 중 하나여야 합니다.
스크리닝에서 yes로 답한 항목과 정합성을 유지하는 자산을 반드시 포함하세요.`;
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
