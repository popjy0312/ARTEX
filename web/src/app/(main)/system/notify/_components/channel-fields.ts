// 渠道字段表와구성值의解析도구。
//
// 와页面拆开은因을 위해这一份은**데이터**而않음은视图：它설명每种渠道있음哪些字段、
// 各自该用什么控件，및表单文本到구성值（JSON）의双向转换。
// 单独放한 개파일后，新增渠道只필요动这里，页面本身않음必改。
// 渠道유형의展示名와简介。放에서 전端은因을 위해它只影响文案，后端않음필요知道。
export const KIND_LABEL: Record<string, string> = {
  dingtalk: "DingTalk",
  feishu: "Feishu",
  wecom: "WeCom",
  webhook: "일반 Webhook",
  telegram: "Telegram",
  email: "이메일",
};

// 各渠道의구성字段定义。
//
// 这里刻意保留一份 전端字段表，而않음은让后端下发 schema：后端只负责
// Validate（必填/格式），UI 필요의은布局와控件유형，两者关注의않음은同一件事。
// 唯一의耦合点은 secret_keys —— 哪些字段该渲染成비밀번호框由后端给출력，
// 因을 위해只있음渠道实现自己清楚哪些值算凭据（企业微信의整개 Webhook 就은凭据，
// 而钉钉의只은그중한 개 secret）。新增渠道时这里少한 개개目只会让表单变空白，
// 않음会静默출력错（下面의 hasFields 会提示）。
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
  dingtalk: [
    {
      key: "webhook",
      label: "Webhook 주소",
      kind: "text",
      placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
    },
    {
      key: "secret",
      label: "키",
      kind: "password",
      help: "봇 보안 설정에서 서명 검증을 켠 경우 입력하세요. 사용자 지정 보안 설정이 없으면 비워 두세요.",
    },
  ],
  feishu: [
    {
      key: "webhook",
      label: "Webhook 주소",
      kind: "text",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
    },
    { key: "secret", label: "서명 검증 키", kind: "password", help: "봇 설정에서 서명 검증을 켠 경우 입력하세요. 그렇지 않으면 비워 두세요." },
  ],
  wecom: [
    {
      key: "webhook",
      label: "Webhook 주소",
      kind: "text",
      placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
    },
  ],
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
    { key: "headers", label: "사용자 지정 요청 헤더", kind: "kv", help: "한 줄에 KEY=VALUE 형식으로 입력합니다. 예: Authorization=Bearer xxx" },
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
    { key: "tls", label: "암시적 TLS", kind: "switch", help: "465 포트에서 사용합니다. 587에서는 끄면 자동으로 STARTTLS를 사용합니다." },
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

// parseKV 解析「每줄 KEY=VALUE」의文本域。
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
// parseIDs 解析逗号/空白分隔의 id 列表。
export function parseIDs(text: string): number[] {
  return text
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}
// parseKeywords 解析줄/逗号分隔의关键词列表（漏洞유형名可能含空格，所以按줄또는逗号切）。
export function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
