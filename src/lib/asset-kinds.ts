// Asset kinds collected in the inventory step.
// The inventory feeds later Decision Tree evaluation for mechanisms like
// ACM, AUM, SCM, NMM, TCM, RLM, SUM, CCK, SSM, DLM, UNM, etc.

import type { StandardId } from "./mechanisms";

export type AssetKind =
  | "security_asset"
  | "network_asset"
  | "privacy_asset"
  | "financial_asset"
  | "network_interface"
  | "network_service"
  | "data_flow"
  | "physical_interface"
  // ACM instances — named inline at the bottom of ACM-2 DT, not in inventory
  | "acm_instance"
  // SUM instances — named inline at the bottom of SUM-1 DT (PASS only)
  | "sum_instance";

// Category still on the config type for backward compat with existing shapes,
// but only "asset" is meaningful now.
export type InventoryCategory = "asset";

export type AssetFieldType = "text" | "select" | "textarea";

export type AssetFieldOption = {
  value: string;
  label_ko: string;
  label_en: string;
};

export type AssetFieldSpec = {
  name: string; // key inside metadata JSON
  label_ko: string;
  label_en: string;
  type: AssetFieldType;
  required?: boolean;
  placeholder?: string;
  options?: AssetFieldOption[];
};

export type AssetKindConfig = {
  kind: AssetKind;
  category: InventoryCategory; // "asset" | "mechanism"
  // For mechanism kinds, the EN 18031 mechanism code ("ACM", "AUM", ...)
  // that this inventory feeds. Used to filter by screening candidates.
  mechanismCode?: string;
  // Which standards this kind is relevant to. If omitted, treated as [1,2,3]
  // (applies across all standards). Used to filter inventory sections by the
  // project's applicable standards (from screening).
  standards?: StandardId[];
  title_ko: string;
  title_en: string;
  description_ko: string;
  description_en: string;
  namePlaceholder: string;
  metadataFields: AssetFieldSpec[];
  listColumns: string[];
  // When true, this kind is hidden from the asset inventory pages — used for
  // kinds collected inline from elsewhere (e.g. acm_instance from ACM-2 DT).
  hideFromInventory?: boolean;
};

// Display order: protected assets first (SA→NA→PA→FA),
// then concrete interfaces/services/flows, then physical interfaces.
export const ASSET_KINDS: AssetKindConfig[] = [
  {
    kind: "security_asset",
    category: "asset",
    title_ko: "보안 자산",
    title_en: "Security Assets",
    description_ko:
      "보호되어야 할 보안 파라미터·기능·데이터 (비밀번호, 키, 인증서, 보안 설정, 펌웨어 이미지 등). ACM·SSM·SUM·CCK 평가 입력.",
    description_en:
      "Security parameters, functions and data to protect (passwords, keys, certificates, security configs, firmware images). Feeds ACM / SSM / SUM / CCK evaluation.",
    namePlaceholder: "예: 관리자 비밀번호 / TLS 클라이언트 인증서",
    listColumns: ["nature", "protection", "type", "sensitivity", "storage"],
    metadataFields: [
      {
        name: "nature",
        label_ko: "자산 성격",
        label_en: "Asset Nature",
        type: "select",
        required: true,
        options: [
          {
            value: "parameter",
            label_ko: "보안 파라미터 (변수·데이터)",
            label_en: "Security Parameter (variable/data)",
          },
          {
            value: "function",
            label_ko: "보안 기능",
            label_en: "Security Function",
          },
        ],
      },
      {
        name: "protection",
        label_ko: "보호 요구",
        label_en: "Protection Needs",
        type: "select",
        required: true,
        options: [
          { value: "confidentiality", label_ko: "기밀성 (C)", label_en: "Confidentiality (C)" },
          { value: "integrity", label_ko: "무결성 (I)", label_en: "Integrity (I)" },
          { value: "both", label_ko: "기밀성 + 무결성 (C+I)", label_en: "Both (C+I)" },
        ],
      },
      {
        name: "type",
        label_ko: "자산 유형",
        label_en: "Asset Type",
        type: "select",
        required: true,
        options: [
          { value: "credential", label_ko: "계정/비밀번호", label_en: "Credential / Password" },
          { value: "key", label_ko: "암호 키", label_en: "Cryptographic Key" },
          { value: "certificate", label_ko: "인증서", label_en: "Certificate" },
          { value: "token", label_ko: "세션/액세스 토큰", label_en: "Session / Access Token" },
          { value: "security_config", label_ko: "보안 설정값", label_en: "Security Configuration" },
          { value: "firmware_image", label_ko: "펌웨어 이미지", label_en: "Firmware Image" },
          { value: "security_function", label_ko: "보안 기능", label_en: "Security Function" },
          { value: "audit_log", label_ko: "감사 로그", label_en: "Audit Log" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "sensitivity",
        label_ko: "민감도",
        label_en: "Sensitivity",
        type: "select",
        required: true,
        options: [
          { value: "low", label_ko: "낮음", label_en: "Low" },
          { value: "medium", label_ko: "보통", label_en: "Medium" },
          { value: "high", label_ko: "높음", label_en: "High" },
          { value: "critical", label_ko: "매우 중요", label_en: "Critical" },
        ],
      },
      {
        name: "storage",
        label_ko: "저장 위치",
        label_en: "Storage",
        type: "select",
        options: [
          { value: "nvm", label_ko: "비휘발성(NVM/Flash)", label_en: "Non-volatile (NVM/Flash)" },
          { value: "secure_element", label_ko: "보안 요소(SE/TPM)", label_en: "Secure Element (SE/TPM)" },
          { value: "ram", label_ko: "휘발성(RAM)", label_en: "Volatile (RAM)" },
          { value: "external", label_ko: "외부(SD 등)", label_en: "External (SD etc.)" },
          { value: "remote", label_ko: "원격 저장", label_en: "Remote storage" },
          { value: "factory", label_ko: "공장 프로비저닝", label_en: "Factory-provisioned" },
        ],
      },
    ],
  },
  {
    kind: "network_asset",
    category: "asset",
    standards: [1],
    title_ko: "네트워크 자산",
    title_en: "Network Assets",
    description_ko:
      "네트워크 상에서 보호해야 하는 자원·기능 (노출된 관리 API, 텔레메트리 채널, 제어 엔드포인트 등). RLM·NMM·TCM 평가 입력.",
    description_en:
      "Network-reachable resources and functions to protect (exposed management APIs, telemetry channels, control endpoints). Feeds RLM / NMM / TCM evaluation.",
    namePlaceholder: "예: 관리 API 엔드포인트 / 제어 명령 채널",
    listColumns: ["nature", "role", "accessibility"],
    metadataFields: [
      {
        name: "nature",
        label_ko: "자산 성격",
        label_en: "Asset Nature",
        type: "select",
        required: true,
        options: [
          {
            value: "parameter",
            label_ko: "네트워크 파라미터 (변수·설정)",
            label_en: "Network Parameter (variable/config)",
          },
          {
            value: "function",
            label_ko: "네트워크 기능",
            label_en: "Network Function",
          },
        ],
      },
      {
        name: "role",
        label_ko: "역할",
        label_en: "Role",
        type: "select",
        required: true,
        options: [
          { value: "exposed", label_ko: "기기가 노출 (서버 측)", label_en: "Exposed by device (server side)" },
          { value: "consumed", label_ko: "기기가 소비 (클라이언트 측)", label_en: "Consumed by device (client side)" },
          { value: "internal", label_ko: "내부 전용", label_en: "Internal only" },
        ],
      },
      {
        name: "accessibility",
        label_ko: "접근성",
        label_en: "Accessibility",
        type: "select",
        required: true,
        options: [
          { value: "public", label_ko: "인터넷 공개", label_en: "Internet-facing" },
          { value: "authenticated", label_ko: "인증 후 접근", label_en: "Authenticated access" },
          { value: "local_only", label_ko: "로컬 네트워크 전용", label_en: "Local network only" },
          { value: "internal", label_ko: "기기 내부", label_en: "Device-internal" },
        ],
      },
    ],
  },
  {
    kind: "privacy_asset",
    category: "asset",
    standards: [2],
    title_ko: "개인정보 자산",
    title_en: "Privacy Assets",
    description_ko:
      "기기가 수집·처리·저장하는 개인정보 항목 (이름·연락처·위치·생체정보 등). EN 18031-2 범위, DLM·UNM 평가 입력.",
    description_en:
      "Personal data items collected, processed, or stored by the device (identity, contact, location, biometric, etc.). Feeds EN 18031-2 / DLM / UNM evaluation.",
    namePlaceholder: "예: 사용자 이메일 주소 / 위치 정보",
    listColumns: ["dataType", "sensitivity", "storage"],
    metadataFields: [
      {
        name: "dataType",
        label_ko: "개인정보 유형",
        label_en: "Data Type",
        type: "select",
        required: true,
        options: [
          { value: "identity", label_ko: "신원 식별자 (이름·주민번호 등)", label_en: "Identity (name, national ID)" },
          { value: "contact", label_ko: "연락처 (이메일·전화·주소)", label_en: "Contact (email, phone, address)" },
          { value: "location", label_ko: "위치 정보", label_en: "Location" },
          { value: "biometric", label_ko: "생체 정보 (지문·얼굴·음성)", label_en: "Biometric (fingerprint, face, voice)" },
          { value: "health", label_ko: "건강·의료 정보", label_en: "Health / medical" },
          { value: "financial_pii", label_ko: "금융 관련 개인정보", label_en: "Financial PII" },
          { value: "behavioral", label_ko: "행동·이용 기록", label_en: "Behavioral / usage" },
          { value: "device_id", label_ko: "기기 식별자 (IMEI·MAC·AdID)", label_en: "Device ID (IMEI, MAC, AdID)" },
          { value: "children", label_ko: "아동 정보", label_en: "Children's data" },
          { value: "credentials_pii", label_ko: "사용자 자격증명", label_en: "User credentials" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "sensitivity",
        label_ko: "민감도",
        label_en: "Sensitivity",
        type: "select",
        required: true,
        options: [
          { value: "standard", label_ko: "일반 개인정보", label_en: "Standard personal data" },
          { value: "sensitive", label_ko: "민감정보 (건강·생체·아동 등)", label_en: "Sensitive (health, biometric, children)" },
        ],
      },
      {
        name: "storage",
        label_ko: "저장 위치",
        label_en: "Storage Location",
        type: "select",
        options: [
          { value: "on_device", label_ko: "기기 내부", label_en: "On the device" },
          { value: "backend", label_ko: "자사 백엔드", label_en: "Own backend" },
          { value: "third_party", label_ko: "제3자 (클라우드/처리자)", label_en: "Third party (cloud / processor)" },
          { value: "hybrid", label_ko: "혼합", label_en: "Hybrid" },
          { value: "transient", label_ko: "일시적 (저장 안함)", label_en: "Transient (not stored)" },
        ],
      },
    ],
  },
  {
    kind: "financial_asset",
    category: "asset",
    standards: [3],
    title_ko: "금융 자산",
    title_en: "Financial Assets",
    description_ko:
      "금전·금전적 가치 또는 결제 관련 자산 (결제 토큰, 거래 기록, 잔액, 결제 수단, 지갑 등). EN 18031-3 평가 대상.",
    description_en:
      "Monetary or monetary-equivalent assets (payment tokens, transaction records, balances, payment methods, wallets). In scope of EN 18031-3.",
    namePlaceholder: "예: 결제 카드 토큰 / 거래 기록 / 지갑 잔액",
    listColumns: ["nature", "type", "value_form", "storage"],
    metadataFields: [
      {
        name: "nature",
        label_ko: "자산 성격",
        label_en: "Asset Nature",
        type: "select",
        required: true,
        options: [
          {
            value: "parameter",
            label_ko: "금융 데이터·설정 (변수)",
            label_en: "Financial Data/Config (variable)",
          },
          {
            value: "function",
            label_ko: "금융 기능",
            label_en: "Financial Function",
          },
        ],
      },
      {
        name: "type",
        label_ko: "자산 유형",
        label_en: "Asset Type",
        type: "select",
        required: true,
        options: [
          { value: "payment_token", label_ko: "결제 토큰", label_en: "Payment Token" },
          { value: "payment_method", label_ko: "결제 수단(카드/계좌)", label_en: "Payment Method (card/account)" },
          { value: "transaction_record", label_ko: "거래 기록", label_en: "Transaction Record" },
          { value: "balance", label_ko: "잔액/충전금", label_en: "Balance / Stored Value" },
          { value: "receipt", label_ko: "영수증", label_en: "Receipt" },
          { value: "wallet", label_ko: "지갑 (암호화폐 등)", label_en: "Wallet (crypto etc.)" },
          { value: "subscription", label_ko: "구독·결제 설정", label_en: "Subscription / Billing Config" },
          { value: "voucher", label_ko: "바우처/쿠폰", label_en: "Voucher / Coupon" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "value_form",
        label_ko: "가치 형태",
        label_en: "Value Form",
        type: "select",
        required: true,
        options: [
          { value: "direct_money", label_ko: "직접 금전(법정화폐)", label_en: "Direct money (fiat)" },
          { value: "money_equivalent", label_ko: "금전 등가", label_en: "Money equivalent" },
          { value: "loyalty", label_ko: "포인트·마일리지", label_en: "Loyalty points / miles" },
          { value: "crypto", label_ko: "암호화폐", label_en: "Cryptocurrency" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "storage",
        label_ko: "저장 위치",
        label_en: "Storage Location",
        type: "select",
        options: [
          { value: "local_device", label_ko: "기기 내부", label_en: "On the device" },
          { value: "backend", label_ko: "자사 백엔드", label_en: "Own backend" },
          { value: "third_party", label_ko: "제3자 (PG/은행/지갑)", label_en: "Third party (PSP/bank/wallet)" },
          { value: "hybrid", label_ko: "혼합", label_en: "Hybrid" },
        ],
      },
    ],
  },
  {
    kind: "network_interface",
    category: "asset",
    title_ko: "네트워크 인터페이스",
    title_en: "Network Interfaces",
    description_ko:
      "기기가 제공하거나 사용하는 통신 인터페이스 (Wi-Fi, Bluetooth, 이더넷, 셀룰러, RFID 등). NMM·RLM·TCM 평가 입력.",
    description_en:
      "Communication interfaces provided or used by the device. Feeds NMM / RLM / TCM evaluation.",
    namePlaceholder: "예: Wi-Fi 2.4GHz / e.g., Wi-Fi 2.4GHz",
    listColumns: ["type", "role", "exposed_factory_default"],
    metadataFields: [
      {
        name: "type",
        label_ko: "인터페이스 유형",
        label_en: "Interface Type",
        type: "select",
        required: true,
        options: [
          { value: "wifi", label_ko: "Wi-Fi", label_en: "Wi-Fi" },
          { value: "bluetooth", label_ko: "Bluetooth / BLE", label_en: "Bluetooth / BLE" },
          { value: "ethernet", label_ko: "이더넷", label_en: "Ethernet" },
          { value: "cellular", label_ko: "셀룰러 (LTE/5G)", label_en: "Cellular (LTE/5G)" },
          { value: "zigbee", label_ko: "Zigbee", label_en: "Zigbee" },
          { value: "zwave", label_ko: "Z-Wave", label_en: "Z-Wave" },
          { value: "lora", label_ko: "LoRa / LoRaWAN", label_en: "LoRa / LoRaWAN" },
          { value: "nfc", label_ko: "NFC", label_en: "NFC" },
          { value: "rfid", label_ko: "RFID", label_en: "RFID" },
          { value: "uwb", label_ko: "UWB", label_en: "UWB" },
          { value: "usb", label_ko: "USB (네트워크)", label_en: "USB (networking)" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "role",
        label_ko: "역할",
        label_en: "Role",
        type: "select",
        required: true,
        options: [
          { value: "client", label_ko: "클라이언트", label_en: "Client" },
          { value: "server_ap", label_ko: "서버 / AP", label_en: "Server / AP" },
          { value: "both", label_ko: "양방향", label_en: "Both" },
        ],
      },
      {
        name: "exposed_factory_default",
        label_ko: "공장 기본 상태에서 노출 여부",
        label_en: "Exposed in Factory Default",
        type: "select",
        required: true,
        options: [
          {
            value: "yes",
            label_ko: "노출됨 (GEC-4 평가 대상)",
            label_en: "Exposed (subject to GEC-4)",
          },
          {
            value: "no",
            label_ko: "노출되지 않음",
            label_en: "Not exposed",
          },
        ],
      },
    ],
  },
  {
    kind: "network_service",
    category: "asset",
    title_ko: "네트워크 서비스",
    title_en: "Network Services",
    description_ko:
      "기기에서 실행되거나 기기가 접속하는 네트워크 서비스 (프로토콜·포트·방향·필수 여부).",
    description_en:
      "Network services exposed by or consumed by the device (protocol, port, direction, required/optional).",
    namePlaceholder: "예: Web UI / MQTT 브로커 연결 / e.g., Web UI, MQTT broker",
    listColumns: ["protocol", "optionality", "direction", "port"],
    metadataFields: [
      {
        name: "protocol",
        label_ko: "프로토콜",
        label_en: "Protocol",
        type: "select",
        required: true,
        options: [
          { value: "https", label_ko: "HTTPS", label_en: "HTTPS" },
          { value: "http", label_ko: "HTTP", label_en: "HTTP" },
          { value: "wss", label_ko: "WSS (WebSocket Secure)", label_en: "WSS (WebSocket Secure)" },
          { value: "ws", label_ko: "WS (WebSocket)", label_en: "WS (WebSocket)" },
          { value: "mqtts", label_ko: "MQTTS", label_en: "MQTTS" },
          { value: "mqtt", label_ko: "MQTT", label_en: "MQTT" },
          { value: "coaps", label_ko: "CoAPs", label_en: "CoAPs" },
          { value: "coap", label_ko: "CoAP", label_en: "CoAP" },
          { value: "ocpp_2_0_1", label_ko: "OCPP 2.0.1", label_en: "OCPP 2.0.1" },
          { value: "ocpp_1_6", label_ko: "OCPP 1.6", label_en: "OCPP 1.6" },
          { value: "ocpi", label_ko: "OCPI (로밍)", label_en: "OCPI (roaming)" },
          { value: "iso15118", label_ko: "ISO 15118 (Plug & Charge)", label_en: "ISO 15118 (Plug & Charge)" },
          { value: "modbus", label_ko: "Modbus", label_en: "Modbus" },
          { value: "ssh", label_ko: "SSH", label_en: "SSH" },
          { value: "telnet", label_ko: "Telnet", label_en: "Telnet" },
          { value: "ftp", label_ko: "FTP", label_en: "FTP" },
          { value: "sftp", label_ko: "SFTP", label_en: "SFTP" },
          { value: "dns", label_ko: "DNS", label_en: "DNS" },
          { value: "ntp", label_ko: "NTP", label_en: "NTP" },
          { value: "tcp", label_ko: "TCP (custom)", label_en: "TCP (custom)" },
          { value: "udp", label_ko: "UDP (custom)", label_en: "UDP (custom)" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "optionality",
        label_ko: "필수 여부",
        label_en: "Optionality",
        type: "select",
        required: true,
        options: [
          {
            value: "required",
            label_ko: "필수 (기기 동작에 반드시 필요)",
            label_en: "Required (essential for device operation)",
          },
          {
            value: "optional",
            label_ko: "선택 (사용자가 비활성화 가능)",
            label_en: "Optional (can be disabled by user)",
          },
        ],
      },
      {
        name: "direction",
        label_ko: "방향",
        label_en: "Direction",
        type: "select",
        required: true,
        options: [
          { value: "inbound", label_ko: "수신 (서버)", label_en: "Inbound (Server)" },
          { value: "outbound", label_ko: "송신 (클라이언트)", label_en: "Outbound (Client)" },
          { value: "both", label_ko: "양방향", label_en: "Both" },
        ],
      },
      {
        name: "port",
        label_ko: "포트",
        label_en: "Port",
        type: "text",
        placeholder: "예: 443, 8883",
      },
    ],
  },
  {
    kind: "data_flow",
    category: "asset",
    title_ko: "데이터 흐름",
    title_en: "Data Flows",
    description_ko: "기기가 송·수신하는 데이터의 상대방과 목적. SCM·DLM 평가의 기반이 됩니다.",
    description_en:
      "Peers the device communicates with and the purpose of each flow. Feeds SCM / DLM evaluation.",
    namePlaceholder: "예: 클라우드 텔레메트리 업로드 / e.g., Telemetry upload to cloud",
    listColumns: ["peer", "direction", "dataCategory"],
    metadataFields: [
      {
        name: "peer",
        label_ko: "통신 상대",
        label_en: "Peer",
        type: "text",
        required: true,
        placeholder: "예: AWS IoT, 사용자 모바일 앱, 벤더 포털",
      },
      {
        name: "direction",
        label_ko: "방향",
        label_en: "Direction",
        type: "select",
        required: true,
        options: [
          { value: "outbound", label_ko: "송신", label_en: "Outbound" },
          { value: "inbound", label_ko: "수신", label_en: "Inbound" },
          { value: "bidirectional", label_ko: "양방향", label_en: "Bidirectional" },
        ],
      },
      {
        name: "dataCategory",
        label_ko: "데이터 분류",
        label_en: "Data Category",
        type: "select",
        required: true,
        options: [
          { value: "telemetry", label_ko: "텔레메트리·센서", label_en: "Telemetry / Sensor" },
          { value: "personal", label_ko: "개인정보", label_en: "Personal Data" },
          { value: "auth", label_ko: "인증·자격증명", label_en: "Credentials" },
          { value: "config", label_ko: "설정", label_en: "Configuration" },
          { value: "firmware", label_ko: "펌웨어·업데이트", label_en: "Firmware / Update" },
          { value: "logs", label_ko: "로그·진단", label_en: "Logs / Diagnostics" },
          { value: "command", label_ko: "제어 명령", label_en: "Control Command" },
          { value: "payment", label_ko: "금전·결제", label_en: "Financial / Payment" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
    ],
  },
  {
    kind: "physical_interface",
    category: "asset",
    title_ko: "물리적 인터페이스",
    title_en: "Physical Interfaces",
    description_ko:
      "비통신 목적의 물리 포트 (USB 데이터, 시리얼, JTAG, SD 카드, GPIO, 디버그 핀 등). 물리 접근 기반 공격 면 평가에 사용됩니다.",
    description_en:
      "Non-networking physical ports (USB data, serial, JTAG, SD card, GPIO, debug pins). Used for evaluating physical attack surface.",
    namePlaceholder: "예: USB Type-A (Data) / JTAG Debug Header",
    listColumns: ["type", "accessibility", "purpose"],
    metadataFields: [
      {
        name: "type",
        label_ko: "포트 유형",
        label_en: "Port Type",
        type: "select",
        required: true,
        options: [
          { value: "usb", label_ko: "USB (데이터)", label_en: "USB (data)" },
          { value: "serial_uart", label_ko: "Serial / UART", label_en: "Serial / UART" },
          { value: "jtag", label_ko: "JTAG", label_en: "JTAG" },
          { value: "swd", label_ko: "SWD", label_en: "SWD" },
          { value: "spi", label_ko: "SPI", label_en: "SPI" },
          { value: "i2c", label_ko: "I²C", label_en: "I²C" },
          { value: "sd_card", label_ko: "SD 카드 슬롯", label_en: "SD card slot" },
          { value: "gpio", label_ko: "GPIO", label_en: "GPIO" },
          { value: "debug_pins", label_ko: "디버그 핀/패드", label_en: "Debug pins/pads" },
          { value: "audio", label_ko: "오디오 잭", label_en: "Audio jack" },
          { value: "hdmi", label_ko: "HDMI / DP", label_en: "HDMI / DisplayPort" },
          { value: "power", label_ko: "전원(데이터 없음)", label_en: "Power only" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
      {
        name: "accessibility",
        label_ko: "접근 가능성",
        label_en: "Accessibility",
        type: "select",
        required: true,
        options: [
          { value: "always", label_ko: "상시 노출 (외부)", label_en: "Always exposed" },
          { value: "removable_cover", label_ko: "커버 제거 시 접근", label_en: "Behind removable cover" },
          { value: "internal", label_ko: "내부 (분해 필요)", label_en: "Internal (disassembly required)" },
          { value: "factory_only", label_ko: "공장 전용", label_en: "Factory only" },
        ],
      },
      {
        name: "purpose",
        label_ko: "용도",
        label_en: "Purpose",
        type: "select",
        options: [
          { value: "data", label_ko: "데이터 입출력", label_en: "Data I/O" },
          { value: "programming", label_ko: "프로그래밍/디버그", label_en: "Programming / debug" },
          { value: "peripheral", label_ko: "주변기기 연결", label_en: "Peripheral" },
          { value: "storage", label_ko: "저장 매체", label_en: "Storage media" },
          { value: "power", label_ko: "전원 공급", label_en: "Power" },
          { value: "other", label_ko: "기타", label_en: "Other" },
        ],
      },
    ],
  },
  {
    // Named inline from ACM-2 DT. Hidden from the main asset inventory.
    kind: "acm_instance",
    category: "asset",
    hideFromInventory: true,
    title_ko: "접근 통제 메커니즘",
    title_en: "Access Control Mechanism",
    description_ko: "ACM-2에서 등록한 접근 통제 메커니즘. AUM 요구사항의 반복 단위로 사용됩니다.",
    description_en: "Access control mechanism registered from ACM-2; iterated by AUM requirements.",
    namePlaceholder: "예: 관리자 로그인 / API 토큰 인증",
    listColumns: [],
    metadataFields: [
      {
        name: "interface_network",
        label_ko: "네트워크 인터페이스",
        label_en: "Network Interface",
        type: "select",
        options: [
          { value: "yes", label_ko: "예", label_en: "Yes" },
          { value: "no", label_ko: "아니오", label_en: "No" },
        ],
      },
      {
        name: "interface_user",
        label_ko: "사용자 인터페이스",
        label_en: "User Interface",
        type: "select",
        options: [
          { value: "yes", label_ko: "예", label_en: "Yes" },
          { value: "no", label_ko: "아니오", label_en: "No" },
        ],
      },
      {
        name: "interface_machine",
        label_ko: "머신 인터페이스",
        label_en: "Machine Interface",
        type: "select",
        options: [
          { value: "yes", label_ko: "예", label_en: "Yes" },
          { value: "no", label_ko: "아니오", label_en: "No" },
        ],
      },
      {
        name: "password_type",
        label_ko: "비밀번호 유형",
        label_en: "Password Type",
        type: "select",
        options: [
          {
            value: "factory_default",
            label_ko: "공장 기본 비밀번호 사용",
            label_en: "Factory default password",
          },
          {
            value: "user_set",
            label_ko: "사용자 설정 비밀번호 (공장 기본 아님)",
            label_en: "User-set password (non factory default)",
          },
          {
            value: "third_party",
            label_ko: "타사 솔루션 사용 (타사 로그인 비밀번호)",
            label_en: "Third-party solution (third-party login password)",
          },
          {
            value: "none",
            label_ko: "비밀번호 미사용 (생체·토큰·인증서 등)",
            label_en: "No password (biometric, token, certificate, etc.)",
          },
        ],
      },
    ],
  },
  {
    // Named inline from SUM-1 DT (when PASS). Hidden from the main asset inventory.
    kind: "sum_instance",
    category: "asset",
    hideFromInventory: true,
    title_ko: "보안 업데이트 메커니즘",
    title_en: "Secure Update Mechanism",
    description_ko: "SUM-1이 PASS인 경우 등록한 업데이트 메커니즘. SUM-2/SUM-3의 반복 단위.",
    description_en: "Secure update mechanism registered from SUM-1 (when PASS); iterated by SUM-2/SUM-3.",
    namePlaceholder: "예: OTA 펌웨어 업데이트 / 서명된 이미지 업데이트",
    listColumns: [],
    metadataFields: [],
  },
];

// Kind list filtered by category — only "asset" category remains after the
// mechanism inventory removal. Also excludes hidden kinds like acm_instance.
export const ASSET_ONLY_KINDS: AssetKindConfig[] = ASSET_KINDS.filter(
  (k) => k.category === "asset" && !k.hideFromInventory,
);

// True if a kind is relevant under ANY of the given applicable standards.
// A kind without explicit `standards` applies to every standard.
export function kindAppliesToStandards(
  kind: AssetKindConfig,
  applicable: StandardId[],
): boolean {
  if (!kind.standards || kind.standards.length === 0) return true;
  return kind.standards.some((s) => applicable.includes(s));
}

export function applicableAssetKinds(
  applicable: StandardId[],
): AssetKindConfig[] {
  return ASSET_ONLY_KINDS.filter((k) => kindAppliesToStandards(k, applicable));
}

export function kindConfig(kind: string): AssetKindConfig | undefined {
  return ASSET_KINDS.find((k) => k.kind === kind);
}

/**
 * Look up a metadata field's bilingual label by (kindConfig, fieldName).
 * Returns `{ ko, en }` with the field's Korean/English labels. Returns
 * `{ ko: fieldName, en: fieldName }` as a fallback when not found.
 */
export function fieldLabel(
  kind: AssetKindConfig,
  fieldName: string,
): { ko: string; en: string } {
  const f = kind.metadataFields.find((m) => m.name === fieldName);
  if (!f) return { ko: fieldName, en: fieldName };
  return { ko: f.label_ko, en: f.label_en };
}

/**
 * Look up a select-option's bilingual label by (kindConfig, fieldName, optionValue).
 * Returns `{ ko, en }`. Falls back to `{ ko: value, en: value }`.
 */
export function optionLabel(
  kind: AssetKindConfig,
  fieldName: string,
  optionValue: string,
): { ko: string; en: string } {
  const f = kind.metadataFields.find((m) => m.name === fieldName);
  const o = f?.options?.find((opt) => opt.value === optionValue);
  if (!o) return { ko: optionValue, en: optionValue };
  return { ko: o.label_ko, en: o.label_en };
}