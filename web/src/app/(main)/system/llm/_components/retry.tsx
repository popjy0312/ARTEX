"use client";

// LLM 다시 시도구성의총：다시 시도의회 +
//
// ：(SDK) → (SDK) →  provider 보안 → 폴링회로 차단 →
//  전엔드포인트，개모델 구성전체기본값；은의，있음전체
//
// 있음입력비워 두면 = 않음구성，와 db.RetryRule ：
//   회   /0 = 기본값 | -1 = 꺼짐다시 시도 | >0 = 개회
//      /0 = 의 | >0 = 개초

import * as React from "react";

import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { LLMRetryOverride, LLMRetryPolicy, LLMRetryRule } from "@/lib/types";

export const ZERO_RULE: LLMRetryRule = { attempts: 0, interval_ms: 0 };
export const ZERO_OVERRIDE: LLMRetryOverride = {
  connect: ZERO_RULE,
  empty: ZERO_RULE,
  stream: ZERO_RULE,
};
const ZERO_POLICY: LLMRetryPolicy = {
  ...ZERO_OVERRIDE,
  breaker: ZERO_RULE,
  intent: ZERO_RULE,
};

type LayerMeta = {
  title: string;
  /** 이다시 시도에서실행 */
  where: string;
  /** 의오류까지이——구체적까지상태，하도록 */
  trigger: string;
  /** 않음이의오류，완료을 위해은 bug */
  skips?: string;
  desc: string;
  attemptsLabel: string;
  /** 회비워 두면 시의기본값，용도 */
  defAttempts: number;
  /** 간격비워 두면 시의기본값정책，용도 */
  defInterval: string;
  /** 회 -1 의 */
  offHint: string;
};

export const RETRY_LAYERS = {
  connect: {
    title: "다시 시도",
    where: "SDK · HTTP 200 이전",
    trigger:
      "HTTP 200 이전의 연결, 시간 초과, DNS 실패 등의 오류와 HTTP 408, 429, 500, 502, 503, 504에서 다시 시도합니다.",
    skips: "400, 401, 403, 404, 413, 422 등 명확한 요청 오류는 다시 시도하지 않습니다.",
    desc: "요청을 다시 보내기 위한 시도입니다. HTTP 200 응답이 오기 전 연결이 끊기면 다시 시도합니다.",
    attemptsLabel: "재시도 횟수",
    defAttempts: 3,
    defInterval: "0.5초 → 1초 → 2초 (최대 8초)",
    offHint: "-1 = 이 단계의 재시도 비활성화(실패를 그대로 반환)",
  },
  empty: {
    title: "빈 응답 재시도",
    where: "SDK · OpenAI 형식만",
    trigger:
      "HTTP 200과 finish_reason=stop이 정상이어도 응답에 내용이 없을 때(빈 텍스트, 추론 필드만 있는 경우 등) 다시 시도합니다.",
    skips:
      "max_tokens로 인해 내용이 없는 응답은 다시 시도하지 않습니다(출력 제한으로 판단하고 설정된 횟수만큼만 재시도).",
    desc: "같은 prompt를 다시 보내며, 이전 응답 내용은 사용하지 않습니다.",
    attemptsLabel: "재시도 횟수",
    defAttempts: 2,
    defInterval: "0.5초 → 1초 → 2초 (최대 8초)",
    offHint: "-1 = 빈 응답 재시도 비활성화",
  },
  stream: {
    title: "동일 provider 스트림 재시도",
    where: "SDK · 출력 도중",
    trigger:
      "HTTP 200 이후 출력이 시작된 뒤 연결이 끊기거나 overloaded, 429 또는 5xx 오류가 발생했을 때(토큰이 일부 반환된 호출) 다시 시도합니다.",
    skips:
      "402 / insufficient_quota(폴링 구성에서 처리), 413 / context length, 400 / 401 / 403 / 404 / 422 등은 다시 시도하지 않습니다.",
    desc: "같은 provider의 다른 구성으로 다시 시도합니다. 이미 생성된 출력은 버리고 모델 출력 또는 도구 실행을 처음부터 다시 시작합니다.",
    attemptsLabel: "재시도 횟수",
    defAttempts: 2,
    defInterval: "0.5초 → 1초 (최대 4초)",
    offHint: "-1 = 의도적 재실행을 제외한 재시도 비활성화",
  },
  breaker: {
    title: "폴링 회로 차단",
    where: "폴링 · 프로세스 전체",
    trigger:
      "429, 5xx 등 일시적인 실패가 일정 횟수 이상 발생하면 회로를 차단합니다. 잔액 부족(402), 키 만료(401 / 403), 모델 없음(404)과 같은 영구 오류는 회로를 차단하지 않습니다.",
    skips: "성공하면 즉시 해당 구성의 회로 차단 상태를 해제합니다.",
    desc: "회로가 차단되면 쿨다운이 적용되고, 쿨다운 동안 폴링은 해당 구성을 건너뜁니다. 상태는 프로세스 재시작 후에도 유지되지 않습니다.",
    attemptsLabel: "차단까지 실패 횟수",
    defAttempts: 3,
    defInterval: "1min→5min→30min ",
    offHint: "-1 = 일시적 실패로 회로를 차단하지 않음(영구 오류는 계속 차단하지 않음)",
  },
  intent: {
    title: "의도적 재실행",
    where: "Agent · 프로세스 전체",
    trigger:
      "실행 전에 worker가 model_error를 반환했을 때 전체 재시도하거나, 출력이 시작된 뒤에도(안전한 경우) 처음부터 다시 실행합니다.",
    skips:
      "이미 폴링 구성을 전환한 경우에는 적용하지 않습니다. 작업 일시 중지, 취소 또는 사용자 입력 대기 상태에서는 백오프하지 않습니다.",
    desc: "전체 실행을 처음부터 다시 시작합니다. 이 단계의 재시도는 다른 재시도 계층과 별도로 적용됩니다.",
    attemptsLabel: "재실행 횟수",
    defAttempts: 2,
    defInterval: " 3s",
    offHint: "-1 = 이 단계의 재실행 비활성화(상태를 blocked로 유지)",
  },
} satisfies Record<string, LayerMeta>;

type LayerKey = keyof typeof RETRY_LAYERS;

/** 초의，만용도에서입력， */
function humanMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))}s`;
  return `${Number((ms / 60_000).toFixed(2))}min`;
}

/** 입력：비어 있음 ↔ 0， 중（"-""1e"）에서로컬，않음 */
function NumField({
  id,
  value,
  onChange,
  placeholder,
  min,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  placeholder: string;
  min: number;
}) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // （읽기정책구성）；않음，
  // 을 위해 value 로컬 parse 의결과
  React.useEffect(() => {
    const incoming = value === 0 ? "" : String(value);
    setText((cur) => (Number(cur || 0) === value ? cur : incoming));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      className="w-28 shrink-0"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        onChange(e.target.value.trim() === "" || !Number.isFinite(n) ? 0 : Math.trunc(n));
      }}
    />
  );
}

/** 다시 시도의개idPrefix 와에서출력회 시 label 의 htmlFor */
export function RetryRuleFields({
  layer,
  idPrefix,
  value,
  onChange,
  compact,
}: {
  layer: LayerKey;
  idPrefix: string;
  value: LLMRetryRule;
  onChange: (r: LLMRetryRule) => void;
  /** true = 구성의：펼치기설명，만오류까지이이 */
  compact?: boolean;
}) {
  const meta = RETRY_LAYERS[layer];
  const human = humanMs(value.interval_ms);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3 rounded-lg border p-3"}>
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <Label className="text-sm">{meta.title}</Label>
          <span className="text-muted-foreground text-xs">{meta.where}</span>
        </div>
        {/* 오류까지이，구체적까지상태——완료않음까지，은오류않음에서이 */}
        <p className="text-muted-foreground text-xs">
          <span className="font-medium text-foreground">조건</span>: {meta.trigger}
        </p>
        {!compact && meta.skips && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium text-foreground">제외 조건</span>: {meta.skips}
          </p>
        )}
        {!compact && <p className="text-muted-foreground text-xs">{meta.desc}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-n`} className="text-muted-foreground text-xs">
            {meta.attemptsLabel}
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-n`}
            min={-1}
            value={value.attempts}
            placeholder={`기본값 ${meta.defAttempts}`}
            onChange={(n) => onChange({ ...value, attempts: n })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${layer}-ms`} className="text-muted-foreground text-xs">
            간격 (ms)
          </Label>
          <NumField
            id={`${idPrefix}-${layer}-ms`}
            min={0}
            value={value.interval_ms}
            placeholder="기본 백오프"
            onChange={(n) => onChange({ ...value, interval_ms: n })}
          />
          <span className="text-muted-foreground text-xs">{human ? ` ${human}` : meta.defInterval}</span>
        </div>
      </div>
      {!compact && <p className="text-muted-foreground text-xs">비워 두면 기본값을 사용합니다. {meta.offHint}.</p>}
    </div>
  );
}

/** 모델 구성의（엔드포인트의그） */
export function ProfileRetryFields({
  value,
  onChange,
}: {
  value: LLMRetryOverride;
  onChange: (o: LLMRetryOverride) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label className="text-sm">재시도</Label>
        <p className="text-muted-foreground text-xs">
          이 구성에만 적용되는 재시도 설정입니다. 비워 두면 "재시도 및 백오프"의 전체 기본값을 따릅니다. 횟수 -1은 해당
          재시도를 끄고, 간격을 비워 두면 기본 지수 백오프를 사용합니다. 회로 차단과 의도적 재실행은 프로세스 전체
          설정이므로 이곳에서는 변경할 수 없습니다.
        </p>
      </div>
      {(["connect", "empty", "stream"] as const).map((k) => (
        <div key={k} className="border-t pt-3 first:border-t-0 first:pt-0">
          <RetryRuleFields
            compact
            layer={k}
            idPrefix="pf"
            value={value[k]}
            onChange={(r) => onChange({ ...value, [k]: r })}
          />
        </div>
      ))}
    </div>
  );
}

/** 재시도 및 백오프tab：의전체기본값 */
export function RetryPolicyPanel() {
  const [policy, setPolicy] = React.useState<LLMRetryPolicy>(ZERO_POLICY);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.llmRetryPolicy();
      setPolicy({ ...ZERO_POLICY, ...p });
    } catch (e) {
      toast.error(`재시도 정책을 불러오지 못했습니다: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // ，새로 고침，
      const saved = await api.saveLLMRetryPolicy(policy);
      setPolicy({ ...ZERO_POLICY, ...saved });
      toast.success("저장했습니다. 새 호출부터 적용됩니다.");
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const set = (k: LayerKey) => (r: LLMRetryRule) => setPolicy((p) => ({ ...p, [k]: r }));

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> 재시도 정책을 불러오는 중…
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs leading-relaxed">
        모델 호출이 실패하면 다음 순서로 처리합니다:
        <span className="text-foreground"> 연결 → 빈 응답 → 동일 provider 스트림 → 폴링 회로 차단 → 의도적 재실행</span>
        . 앞의 세 단계는 모델 구성별 설정이고, 뒤의 두 단계는 프로세스 전체 설정입니다. 각 입력을 비워 두면 내장
        기본값을 사용하며, 이 설정은 모델 구성마다 독립적으로 지정할 수 있습니다.
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(RETRY_LAYERS) as LayerKey[]).map((k) => (
          <RetryRuleFields key={k} layer={k} idPrefix="gl" value={policy[k]} onChange={set(k)} />
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
          저장
        </Button>
        <Button variant="outline" onClick={() => setPolicy(ZERO_POLICY)} disabled={saving}>
          전체 기본값으로 복원
        </Button>
      </div>
    </div>
  );
}
