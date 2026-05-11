// Per-(mechanism, assessment-type) example hints shown next to the technical
// assessment file-upload widget. These are suggestions for what kind of
// evidence file the consultant typically attaches to support each assessment.
//
// The text is bilingual-friendly Korean with quick descriptive examples; if
// no entry is found, a generic fallback is returned.

import type { AssessmentType } from "./types";

const EXAMPLES: Record<string, Partial<Record<AssessmentType, string>>> = {
  ACM: {
    completeness: "권한 매트릭스, 접근 통제 구현 소스 코드, 설정 화면 캡처",
    sufficiency: "비인가 접근 차단 테스트 로그, 권한 우회 시도 결과",
  },
  AUM: {
    completeness: "인증 흐름 다이어그램, 비밀번호 정책·검증 소스 코드",
    sufficiency: "무차별 대입 테스트 로그, 인증 우회 시도 결과",
  },
  SUM: {
    completeness: "업데이트 메커니즘 설계 문서, 서명 검증 소스 코드",
    sufficiency: "펌웨어 무결성 검증 결과, 다운그레이드 공격 테스트 로그",
  },
  SSM: {
    completeness: "보안 저장 구현 문서, 키·자격증명 보관 소스 코드",
    sufficiency: "저장소 추출 시도 결과, 메모리·디스크 덤프 분석",
  },
  SCM: {
    completeness: "TLS 설정, 인증서 체인 정보, 통신 흐름도",
    sufficiency: "TLS 인터셉트 테스트 결과, 평문 노출 패킷 캡처 검사",
  },
  RLM: {
    completeness: "복원력 설계 문서, DoS 방어 설정·소스 코드",
    sufficiency: "DoS 시뮬레이션 결과, 공격 후 복구 동작 로그",
  },
  NMM: {
    completeness: "모니터링 룰 정의, 탐지 시그니처·필터 설정",
    sufficiency: "공격 시뮬레이션 탐지 로그, 오탐·미탐 평가 결과",
  },
  TCM: {
    completeness: "트래픽 제어 룰·정책 정의, 도메인 분리 설계도",
    sufficiency: "정책 위반 차단 테스트 로그, 격리 검증 결과",
  },
  CCK: {
    completeness: "키 생성·관리 소스 코드, 알고리즘·키 길이 명세",
    sufficiency: "키 추출 시도 결과, RNG 통계 분석, 강도 평가 보고",
    conceptual_completeness: "키 관리 설계 문서, 키 라이프사이클 도식",
  },
  GEC: {
    completeness: "사용자·관리자 매뉴얼, 보안 기능 카탈로그, 기본 보안 상태 문서",
    sufficiency: "보안 설정 검증 로그, 노출 인터페이스 점검 결과",
  },
  CRY: {
    completeness: "사용 암호 알고리즘·라이브러리 버전 목록, 키 길이·모드 명세",
    sufficiency: "알고리즘 적합성 검사 결과, NIST/BSI 표준 매핑 보고",
  },
  LGM: {
    completeness: "로깅 정책, 기록 이벤트 정의서, 로그 샘플",
    sufficiency: "감사 이벤트 발생 검증 로그, 무결성 보호 테스트 결과",
  },
  DLM: {
    completeness: "데이터 삭제 기능 소스 코드·UI 캡처, 사용자 가이드",
    sufficiency: "삭제 후 복구 시도 결과, 잔존 데이터 검사 보고",
  },
  UNM: {
    completeness: "사용자 알림 UI 캡처, 알림 정책·트리거 문서",
    sufficiency: "알림 발생 검증 로그, UX·접근성 검수 결과",
  },
};

const FALLBACK: Record<AssessmentType, string> = {
  completeness: "관련 설계 문서·소스 코드·구현 캡처",
  sufficiency: "테스트 로그·검증 결과·증적 자료",
  conceptual_completeness: "보안 개념 문서·아키텍처 도식",
};

export function evidenceExampleFor(
  mechanismCode: string,
  assessmentType: AssessmentType,
): string {
  return EXAMPLES[mechanismCode]?.[assessmentType] ?? FALLBACK[assessmentType];
}
