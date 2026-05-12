// Per-requirement technical-assessment fill. For each (asset/global, type)
// combination, the model writes a draft `testMethod` describing how a
// consultant would verify the requirement. testResult and verdict remain
// user-driven — the consultant runs the test and records the actual outcome.

import type { DTRequirement, AssessmentType } from "@/lib/decision-trees";
import { evidenceExampleFor } from "@/lib/decision-trees";
import { SCREENING_QUESTIONS } from "@/lib/screening-questions";

export type AssessmentAIResult = {
  iterations: Array<{
    assetKey: string;
    methods: Array<{
      type: AssessmentType;
      testMethod: string;
    }>;
  }>;
};

export const ASSESSMENT_SYSTEM_PROMPT = `당신은 EN 18031 자가평가의 기능 평가(테스트 방법)를 작성하는 사이버 보안 컨설턴트입니다.
주어진 요구사항·자산·이전 단계 결과를 근거로, 각 평가 단위·평가 유형(완전성/충분성/개념적 완전성)에 대해 testMethod 초안을 작성하세요. 분량은 6~12문장(번호 매긴 단계 포함) 정도로, 실제 컨설턴트가 그대로 따라할 수 있는 수준의 구체성이어야 합니다.

규칙:
1. **평가 유형별 초점**:
   • completeness (완전성): 메커니즘이 요구사항에 명시된 모든 기능·요소를 갖추었는지 — 설계 문서·소스 코드 검토·구성 확인 위주.
   • sufficiency (충분성): 갖춘 메커니즘이 실제로 위협을 완화하는지 — 실제 시도·페네트레이션 테스트·검증 시나리오 위주.
   • conceptual_completeness (개념적 완전성): CCK-2 등 개념 수준 검토만 요구되는 경우 — 보안 개념 문서·설계 도식 검토.

2. **반드시 다음 4요소를 포함하는 단계별 절차로 작성**:
   (a) **사용 도구를 실명으로** — Wireshark, Burp Suite, nmap, OpenSSL, Postman, Frida, ADB, binwalk, ghidra, hydra, Hashcat, JTAG debugger, sslscan, testssl.sh 등.
   (b) **실제 명령어·동작 예시** — 가능하면 한 줄짜리 명령어를 인용 (예: \`openssl s_client -connect 192.168.1.1:443\`, \`nmap -sV --script ssl-enum-ciphers -p 443 <ip>\`, \`hydra -l admin -P rockyou.txt <ip> http-post-form\`). GUI 도구면 클릭 경로 ("Burp → Proxy → Intercept").
   (c) **확인 지표** — "이 화면/로그/필드에서 X가 보이면" 식으로 무엇을 보고 판정하는지 명시.
   (d) **통과/실패 판정 기준** — "[통과] X일 때, [실패] Y일 때" 형식으로 명확히.

3. **메커니즘별 권장 도구 가이드** (참고만 — 실제 자산·답변에 맞게 선택):
   • ACM (접근 통제): Burp Suite로 권한 우회 시도, Postman으로 인가 헤더 조작, 직접 URL 접근 시도.
   • AUM (인증): hydra/Burp Intruder로 무차별 대입, 비밀번호 정책 검증, 인증 우회 페이로드.
   • SCM (보안 통신): Wireshark로 패킷 캡처 + cipher suite 분석, sslscan/testssl.sh로 TLS 설정 검사, Burp/mitmproxy로 MITM 시도.
   • SUM (보안 업데이트): binwalk·strings·ghidra로 펌웨어 분석, 서명 검증 우회 시도, 다운그레이드 공격.
   • SSM (보안 저장): ADB·Frida·JTAG로 메모리·NVM 덤프, strings로 평문 검색, 암호 키 추출 시도.
   • CCK (암호 키): openssl로 키 생성·강도 분석, dieharder/PractRand로 RNG 통계 분석, 정적 분석으로 하드코딩 키 검색.
   • RLM (복원력): hping3·Slowloris·LOIC 등으로 DoS 시뮬레이션, watchdog 동작 관찰.
   • LGM (로깅): syslog·journalctl·로그 파일 직접 확인, 보안 이벤트 트리거 후 로그 발생 여부.
   • DLM (삭제): 데이터 삭제 후 dd로 디스크 덤프 + grep으로 잔존 검색.
   • UNM (사용자 알림): UI 캡처, 알림 트리거 시나리오 실행.
   • GEC (일반 능력): 매뉴얼 검토, 기본 보안 설정값 확인, 노출 인터페이스 nmap 스캔.

4. **자산 메타데이터 활용**: protocol=HTTPS면 sslscan, type=key면 openssl 강도 분석, exposed_factory_default=yes면 nmap으로 노출 인터페이스 스캔처럼 자산별 도구를 선택해 차별화하세요.

5. **DT 답변 정합**: 사용자가 yes로 답한 것은 "구현되어 있음"이 전제 → 그 구현을 검증하는 테스트. no는 "없음/실패" 전제 → 부재·취약 확인 절차.

6. **출력 형식 (예시)**:
   "1. nmap -sV --script ssl-enum-ciphers -p 443 192.168.1.10 명령으로 대상 기기의 TLS 설정을 스캔한다.
    2. 출력에서 지원되는 cipher suite 목록을 확인한다 (TLS_RSA_WITH_RC4_128_SHA 등 약한 알고리즘 존재 여부).
    3. testssl.sh https://192.168.1.10 으로 TLS 1.0/1.1, weak DH parameters, 알려진 취약점(BEAST·POODLE) 확인.
    4. Wireshark로 클라이언트→기기 통신 패킷 캡처 후 Server Hello에서 실제 협상된 cipher suite와 TLS 버전을 검증한다.
    5. [통과] TLS 1.2 이상 + AEAD cipher(GCM/ChaCha20)만 협상되고 알려진 취약점이 없을 때.
    6. [실패] TLS 1.1 이하·RC4·CBC·NULL·EXPORT cipher 협상 가능, 또는 인증서 체인 오류 발생 시.
    증적: nmap 스캔 결과 텍스트, testssl.sh HTML 리포트, Wireshark pcap 캡처."

7. **증적 파일 예시 안내**: testMethod 마지막 줄에 "증적: ..." 형식으로 컨설턴트가 첨부해야 할 산출물(스캔 결과, 캡처 파일, 스크립트 출력 등)을 1줄로 적으세요.

8. testResult와 verdict는 **절대 미리 채우지 마세요** — 컨설턴트가 실제 테스트 후 직접 기록합니다.`;

function describeIteration(opts: {
  requirement: DTRequirement;
  iteration: {
    assetKey: string;
    label: string;
    metadata: Record<string, string>;
    answeredPath: Array<{ nodeId: string; answer: "yes" | "no" }>;
    applicableTypes: AssessmentType[];
  };
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

  const types = opts.iteration.applicableTypes
    .map((t) => {
      const example = evidenceExampleFor(opts.requirement.mechanismCode, t);
      return `   • type="${t}" — 권장 증적 예시: ${example}`;
    })
    .join("\n");

  return `### 평가 단위 assetKey="${opts.iteration.assetKey}" — ${opts.iteration.label}
자산 메타데이터:
${meta || "   (없음)"}

DT 답변 경로:
${path}

채워야 할 평가 유형:
${types}`;
}

export function buildAssessmentUserPrompt(opts: {
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
    applicableTypes: AssessmentType[];
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

  const blocks = opts.iterations
    .map((it) =>
      describeIteration({
        requirement: opts.requirement,
        iteration: it,
      }),
    )
    .join("\n\n");

  return `다음 요구사항의 기능 평가(testMethod)를 각 평가 단위·유형별로 작성하세요.

=== 제품 정보 ===
${productInfo}

=== 이전 단계: 스크리닝 답변 ===
${screeningContext}

=== 이전 단계: 등록된 자산 인벤토리 ===
${opts.assetSummary || "(자산 없음)"}

=== 요구사항 ===
ID: ${opts.requirement.id}
메커니즘: ${opts.requirement.mechanismCode}
조항: ${opts.requirement.clause}
제목: ${opts.requirement.title_ko}
원문 요구사항:
${opts.requirement.requirementText_ko}

=== 평가 단위별 채울 평가 유형 ===
${blocks}

각 (assetKey, type)마다 testMethod 초안을 **번호 매긴 6~12단계 절차**로 한국어로 작성하세요. 반드시 실제 도구명과 구체적인 명령어(예: nmap -sV -p 443 <ip>, openssl s_client -connect <ip>:443)를 포함하고, 마지막 줄에 "증적: ..." 형식으로 첨부해야 할 산출물을 명시하세요.`;
}

export function buildAssessmentJsonSchema(
  validAssetKeys: string[],
  validTypes: AssessmentType[],
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
            methods: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: { type: "string", enum: validTypes },
                  testMethod: { type: "string" },
                },
                required: ["type", "testMethod"],
              },
            },
          },
          required: ["assetKey", "methods"],
        },
      },
    },
    required: ["iterations"],
  };
}
