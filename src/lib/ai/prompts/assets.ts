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

export const ASSETS_SYSTEM_PROMPT = `당신은 EN 18031-1/2/3 자산 인벤토리 작성을 보조하는 사이버 보안 컨설턴트입니다.
첨부된 제품 문서를 처음부터 끝까지 꼼꼼히 읽고, 표준 정의에 따라 자산을 빠짐없이·중복 없이 등록하세요.

━━━ EN 18031 표준 정의 (반드시 숙지) ━━━

【security_asset】 — sensitive/confidential security parameter OR security function (EN 18031-1 §3.35)
  • security parameter = 보안 기능의 동작을 정의하는 데이터 (§3.37)
    예) 비밀번호, 암호 키, 인증서, TLS 개인키, OTA 서명 검증 키, Secure Boot 공개키, 펌웨어 이미지, 인증서 폐기 목록, 보안 정책 설정값
  • security function = 네트워크에 해를 끼치거나 네트워크 자원 오용을 막는 기기 기능 (§3.36)
    예) TLS 핸드셰이크 모듈, 서명 검증 로직, 무차별 대입 잠금 로직, 감사 로깅 기능, Secure Boot 검증 기능

【network_asset】 — sensitive/confidential network function configuration OR network functions (EN 18031-1 §3.23) — EN 18031-1만 해당
  ⚠️ "기기가 네트워크를 사용/제공하는 기능과, 그 기능의 동작을 정의하는 데이터"입니다. 단순히 "API 엔드포인트"가 아닙니다.
  • network function = 기기가 스스로 네트워크 자원을 제공하거나 사용하는 기능 (§3.25)
    예) Wi-Fi 클라이언트 연결 기능, MQTT 클라이언트 기능, RTSP 서버 기능, 로컬 웹 관리 UI, OTA 업데이트 클라이언트, DHCP 클라이언트, DNS 리졸버, 텔레메트리 전송 기능, P2P 스트림 중계 기능
  • network function configuration = 위 기능들의 동작을 정의하는 데이터 (§3.26)
    예) 저장된 Wi-Fi SSID+비밀번호, 클라우드 서버 URL/도메인, MQTT 브로커 주소, OTA 서버 URL, DNS 서버 주소, NTP 서버 주소, IP/게이트웨이 설정, RTSP URL, 포트 포워딩 규칙(라우터인 경우), 방화벽 규칙(라우터인 경우)
  • "sensitive" = 변조 시 네트워크에 해를 끼치거나 자원 오용 (예: 클라우드 URL 변조 → 악성 서버 연결)
  • "confidential" = 노출 시 네트워크에 해를 끼치거나 자원 오용 (예: Wi-Fi 비밀번호 노출)

【network_service】 — GEC-2/GEC-4 입력: **각 네트워크 인터페이스를 통해 노출되거나 사용되는 서비스 (프로토콜·포트·방향)**
  • 기기가 노출(inbound) 또는 사용(outbound)하는 모든 프로토콜/포트 인스턴스
  • "공장 기본 상태에서 노출 여부"가 GEC-4 평가의 핵심
  예) HTTPS 클라이언트(443/outbound), MQTTS(8883/outbound), RTSP 서버(554/inbound), HTTP 설정 페이지(80/inbound, 초기 셋업), NTP(123/outbound), DNS(53/outbound), mDNS(5353/multicast), DHCP(67/68)

【data_flow】 — SCM/DLM 입력: **기기가 통신하는 상대방(peer)과 데이터 목적**
  예) 기기↔클라우드 백엔드(텔레메트리·제어 명령), 기기↔모바일앱(영상 스트림·설정), 기기↔OTA 서버(펌웨어 다운로드), 기기↔NTP 서버(시각 동기화), 기기↔DNS(이름 조회)

【network_interface】 — 외부 통신 인터페이스 (§3.27): Wi-Fi, Bluetooth/BLE, Ethernet, Cellular, Zigbee 등 물리 매체별 1개씩

【privacy_asset】 — EN 18031-2만 해당. 기기가 수집·처리·저장하는 개인정보 항목
  • sensitivity: 건강·생체·아동 데이터만 "sensitive", 그 외는 "standard"

【physical_interface】 — 비통신 물리 포트: USB(데이터), 시리얼/UART, JTAG/SWD, SD 슬롯, GPIO, 디버그 핀, 리셋 버튼 등

━━━ network_asset vs network_service vs data_flow — 같은 통신을 3개 자산으로 분해 ━━━
하나의 클라우드 통신(MQTTS to broker.example.com:8883)은 아래 셋으로 분해해 모두 등록:
  • network_service → "MQTTS 클라이언트" (protocol=mqtts, port=8883, direction=outbound, optionality=required)
  • network_asset   → "MQTT 클라이언트 기능 + 브로커 주소 설정" (nature=function 또는 parameter, role=consumed, accessibility=authenticated)
  • data_flow       → "기기→클라우드: 텔레메트리·제어 수신" (peer=클라우드 백엔드, direction=bidirectional, dataCategory=telemetry)

━━━ 작업 절차 (이 순서대로 수행) ━━━

1. **문서 전수 스캔** — 다음 섹션을 빠짐없이 읽어 후보 목록 작성:
   a) 포트·프로토콜 표 → 각 행마다 network_service 1개 + 대부분 network_asset 1개 + data_flow 1개
   b) 네트워크 아키텍처/구성도 → 화살표마다 data_flow, 기기가 제공/사용하는 기능마다 network_asset
   c) 암호화·키 관리 표 → 각 키·인증서마다 security_asset (DEK·KEK·세션키·서명키·TLS 개인키·OTA 검증키 등을 모두 분리)
   d) 인증 섹션 → 비밀번호 정책·토큰·MFA 코드를 security_asset
   e) 펌웨어·OTA → firmware_image, OTA 서명 검증키, Secure Boot 키
   f) 하드웨어 표 → 물리 포트마다 physical_interface
   g) 개인정보 표 → 수집·처리 항목마다 privacy_asset
   h) 로그·감사 → audit_log security_asset

2. **논리적 추론으로 누락 보강** — 문서에 명시 안 됐어도 다음은 거의 항상 존재:
   • TLS 통신 언급 → TLS 클라이언트 인증서 + 개인키 (security_asset)
   • OTA 서명 검증 → OTA 서명 검증 공개키 (security_asset, type=key)
   • Secure Boot → Root of Trust 공개키 (security_asset, type=key)
   • Wi-Fi 연결 → 저장된 Wi-Fi SSID+PSK (network_asset, network function configuration)
   • 클라우드 서비스 사용 → 클라우드 서버 URL/도메인 (network_asset, configuration)
   • 시각 동기화 필요 → NTP 서비스 + NTP 서버 주소 설정 (network_asset)
   • 도메인 통신 → DNS 리졸버 + DNS 서버 설정 (network_asset)

3. **중복 제거** — 같은 자산을 다른 이름으로 두 번 만들지 마세요:
   ✗ "Wi-Fi 인터페이스" + "Wi-Fi Interface" (같은 항목)
   ✗ "MQTTS 서비스" + "MQTTS 프로토콜" (같은 항목)
   ✗ "MicroSD 슬롯" (메모리 카드용) + "MicroSD 슬롯" (영상 저장용) — 같은 물리 포트면 1개
   ✓ "TLS API용 인증서" + "TLS OTA용 인증서" (목적이 다르면 분리 가능)

4. **스크리닝 답변 정합성** — yes 답한 항목은 반드시 대응 자산 존재:
   B6(RLM)=yes  → network_asset 다수, network_interface 다수 필요
   B8(키)=yes   → security_asset type=key 다수 필요
   B3(OTA)=yes  → security_asset type=firmware_image + type=key (OTA 서명) 필요
   B11(로그)=yes → security_asset type=audit_log 필요
   A3(개인정보)=yes → privacy_asset 다수 필요

5. **없는 것은 만들지 마세요** — 결제 기능 없으면 financial_asset 없음, 개인정보 처리 없으면 privacy_asset 없음.

━━━ 출력 규칙 ━━━
• metadata.key는 정의된 필드명과 정확히 일치, select 필드 value는 옵션값 중 하나만 사용 (잘못된 값보다 누락이 안전)
• name: 짧고 식별력 있게 (한국어 또는 한/영 병기). 같은 종류의 자산이 여러 개면 용도로 구분 (예: "TLS 인증서 (API용)", "TLS 인증서 (OTA용)")
• description: 근거 문서·섹션 명시 ("암호화_사양서 §3.1 참조", "TLS 통신 구성에서 추론")`;

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

  return `다음 제품 정보·첨부 파일·스크리닝 답변을 근거로 자산 인벤토리를 작성하세요.
시스템 프롬프트의 EN 18031 표준 정의와 5단계 작업 절차를 따르세요.

=== 제품 정보 ===
${productInfo}

=== 이전 단계: 스크리닝 답변 (사용자 검수 완료) ===
${screeningContext}

=== 등록 가능한 자산 종류 ===
${kindsSpec}

【출력 전 자가 점검 (체크 후 출력)】

□ 1. 포트·프로토콜 표의 각 행을 network_service에 모두 등록했는가? (HTTPS, MQTTS, RTSP, NTP, DNS, mDNS, DHCP 등)
□ 2. 위 각 통신에 대응하는 network_asset(기능·설정값)도 등록했는가?
     - 클라우드 통신 → "클라우드 API 서버 URL 설정" + "클라우드 텔레메트리 클라이언트 기능"
     - MQTT 통신 → "MQTT 브로커 주소 설정" + "MQTT 클라이언트 기능"
     - OTA 통신 → "OTA 서버 URL 설정" + "OTA 다운로드 클라이언트 기능"
     - Wi-Fi 연결 → "저장된 Wi-Fi 자격증명 (SSID+PSK)"
     - RTSP 스트리밍 → "RTSP 서버 기능" + "RTSP URL 설정"
     - NTP/DNS → "NTP 서버 주소 설정" / "DNS 서버 주소 설정"
□ 3. 각 통신에 대응하는 data_flow(상대방·목적)도 등록했는가?
     - 기기↔클라우드 / 기기↔모바일앱 / 기기↔OTA서버 / 기기↔NTP / 기기↔DNS 등
□ 4. 암호화 섹션의 각 키·인증서를 별도 security_asset으로 등록했는가?
     - 데이터 암호화 키, 영상 암호화 키, TLS 클라이언트 인증서+개인키, OTA 서명 검증 공개키, Secure Boot 공개키, JWT 서명 키 등
□ 5. 인증 섹션의 비밀번호·토큰·MFA 코드를 security_asset에 등록했는가?
□ 6. 펌웨어 이미지 자체(security_asset, type=firmware_image)를 등록했는가?
□ 7. 감사 로그(security_asset, type=audit_log)를 등록했는가?
□ 8. 물리 포트(USB, 시리얼, JTAG, SD, GPIO, 디버그 핀, 리셋 버튼 등)를 physical_interface에 등록했는가?
□ 9. 개인정보 수집 항목을 privacy_asset에 모두 등록했는가? (sensitivity: 건강/생체/아동만 sensitive, 나머지 standard)
□ 10. 같은 자산을 다른 이름으로 중복 등록하지 않았는가? (예: "Wi-Fi 인터페이스"와 "Wi-Fi Interface", "MQTTS 서비스"와 "MQTTS 프로토콜")
□ 11. 스크리닝에서 yes 답한 항목과 정합되는 자산이 모두 있는가?

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
