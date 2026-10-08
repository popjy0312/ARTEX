// 와구성의도구
//
// 와은을 위해은**데이터**않음은：설명있음
// ，및구성（JSON）의
// 한 개파일，필요，않음
// 유형의와에서 전은을 위해，않음필요
export const KIND_LABEL: Record<string, string> = {
  webhook: "일반 Webhook",
  telegram: "Telegram",
  email: "이메일",
};

// 의구성
//
//  전，않음은 schema：
// Validate（/），UI 필요의은와유형，의않음은
// 의은 secret_keys —— 비밀번호출력，
// 을 위해있음（의개 Webhook 은，
// 의은그중한 개 secret）한 개개，
// 않음출력（의 hasFields ）
export type FieldKind = "text" | "password" | "number" | "select" | "textarea" | "switch" | "kv" | "list";
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}
export const CHANNEL_FIELDS: Record<string, FieldDef[]> = {
  webhook: [
    { key: "url", label: "대상 URL", kind: "text", placeholder: "https://your-endpoint.example.com/hook" },
    {
      key: "method",
      label: "요청 방법",
      kind: "select",
      options: [
        { value: "POST", label: "POST (권장)" },
        { value: "PUT", label: "PUT" },
        { value: "PATCH", label: "PATCH" },
        { value: "GET", label: "GET (권장하지 않음)" },
      ],
    },
    {
      key: "headers",
      label: "사용자 지정 요청 헤더",
      kind: "kv",
      help: "한 줄에 KEY=VALUE 형식으로 입력합니다. 예: Authorization=Bearer xxx",
    },
    {
      key: "body_template",
      label: "본문 템플릿",
      kind: "textarea",
      help:
        "비워 두면 내장 기본 템플릿을 사용합니다. 사용할 수 있는 값: {{.Title}} {{.Batch}} {{.Count}} {{.HomeURL}} {{.SentAt}}, " +
        "그리고 range .Items 안에서 .Name/.VulnClass/.Severity/.Summary/.Assets/.DetailURL/.StatusLabel을 사용할 수 있습니다. " +
        "객체를 JSON 문자열로 넣으려면 {{json .Xxx}}를 사용하고, 그렇지 않으면 제목에 JSON을 입력합니다.",
    },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token", kind: "password", placeholder: "123456:ABC-DEF..." },
    { key: "chat_id", label: "Chat ID", kind: "text", placeholder: "-1001234567890" },
    {
      key: "base_url",
      label: "API 주소",
      kind: "text",
      placeholder: "https://api.telegram.org",
      help: "비워 두면 공식 주소를 사용합니다. 필요할 때 Bot API 경로를 추가하세요.",
    },
  ],
  email: [
    { key: "host", label: "SMTP 서비스", kind: "text", placeholder: "smtp.example.com" },
    {
      key: "port",
      label: "포트",
      kind: "number",
      placeholder: "587",
      help: "587은 STARTTLS, 465는 암시적 TLS를 사용합니다.",
    },
    { key: "username", label: "계정", kind: "text" },
    { key: "password", label: "비밀번호 / 인증 코드", kind: "password" },
    { key: "from", label: "발신자", kind: "text", placeholder: "artex@example.com" },
    { key: "to", label: "수신자", kind: "list", help: "여러 주소는 쉼표로 구분합니다." },
    {
      key: "tls",
      label: "암시적 TLS",
      kind: "switch",
      help: "465 포트에서 사용합니다. 587에서는 끄면 자동으로 STARTTLS를 사용합니다.",
    },
  ],
};

export const SEVERITY_OPTIONS = [
  { value: "", label: "제한 없음" },
  { value: "low", label: "낮음 이상" },
  { value: "medium", label: "중간 이상" },
  { value: "high", label: "높음 이상" },
  { value: "critical", label: "심각" },
];

export type ChannelForm = {
  name: string;
  kind: string;
  mode: "realtime" | "digest";
  enabled: boolean;
  ratePerMin: string;
  config: Record<string, unknown>;
  minSeverity: string;
  includeText: string;
  excludeText: string;
  taskIDsText: string;
  assetIDsText: string;
  onStatusChange: boolean;
};

export const emptyForm = (kind: string): ChannelForm => ({
  name: "",
  kind,
  mode: "realtime",
  enabled: true,
  ratePerMin: "",
  config: {},
  minSeverity: "",
  includeText: "",
  excludeText: "",
  taskIDsText: "",
  assetIDsText: "",
  onStatusChange: false,
});

// parseKV 줄 KEY=VALUE의
export function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
// parseIDs /의 id
export function parseIDs(text: string): number[] {
  return text
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}
// parseKeywords 줄/의（유형，줄또는）
export function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
