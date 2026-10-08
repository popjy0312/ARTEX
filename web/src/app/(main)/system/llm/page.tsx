"use client";

import * as React from "react";

import {
  Loader2Icon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  StarIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { LLMPoolMember, LLMPoolStatus, LLMProfile, LLMRetryOverride } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProfileRetryFields, RetryPolicyPanel, ZERO_OVERRIDE } from "./_components/retry";

// 추론 스위치(thinking.type)와추론 강도(reasoning_effort)은两개【互相独立】의字段，
// 各自单独설정——있음些接口없음 thinking 字段、只靠强度参数就能激活思考，故需解耦。
// 存库空문자열 = 该字段【전송하지 않음】；Radix Select 않음接受空 value，故 UI 用 "none"
// 哨兵의미전송하지 않음，存取时와 "" 互转（NONE / fromStore / toStore）。
const NONE = "none";
const fromStore = (v?: string) => (v ? v : NONE);
const toStore = (v: string) => (v === NONE ? "" : v);
const THINKING_TYPES: { value: string; label: string }[] = [
  { value: NONE, label: "전송하지 않음 (기본값)" },
  { value: "disabled", label: "꺼짐" },
  { value: "enabled", label: "켜짐" },
];
// 출력上限用哪개하세요求字段名（仅 openai 格式있음意义）。NONE ↔ "" 走同一套哨兵转换。
const MAX_TOKENS_FIELDS: { value: string; label: string }[] = [
  { value: NONE, label: "max_tokens (기본값)" },
  { value: "max_completion_tokens", label: "max_completion_tokens" },
];
// 另外两种格式各自定死了字段名，选项对它们없음意义，설명文案里直接讲清楚。
const MAX_TOKENS_FIELD_HINTS: Record<string, string> = {
  openai:
    "두 필드 중 하나를 선택합니다. max_tokens가 기본값이며, OpenAI 공식 모델(o 시리즈 / GPT-5)에서는 max_completion_tokens를 사용해야 합니다. 해당 모델에 max_tokens를 보내면 unsupported_parameter 오류가 발생할 수 있습니다.",
  anthropic: "OpenAI 형식에서만 선택할 수 있습니다. Anthropic은 max_tokens 필드를 사용합니다.",
  "openai-responses": "OpenAI 형식에서만 선택할 수 있습니다. Responses API는 max_output_tokens 필드를 사용합니다.",
};
const EFFORT_LEVELS: { value: string; label: string }[] = [
  { value: NONE, label: "전송하지 않음 (기본값)" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

function cooldownText(secs: number) {
  if (secs <= 0) return "";
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}min`;
}

// 한 개구성에서卡片上显示의「은否정상」。没填 Key 의구성根本发않음출력하세요求，比회로 차단更该先说；
// 其余상태来自폴링의회로 차단记录（폴링关着时않음会产生新记录，此时「정상」= 없음已知故障）。
type Health = { label: string; cls: string; hint?: string };
function healthOf(p: LLMProfile, m?: LLMPoolMember): Health {
  if (!p.api_key_hint) {
    return {
      label: "Key 미설정",
      cls: "border-muted-foreground/40 text-muted-foreground",
      hint: "API Key가 없어 호출할 수 없습니다",
    };
  }
  if (m?.state === "tripped") {
    return {
      label: m.cooldown_secs > 0 ? `차단됨 · ${cooldownText(m.cooldown_secs)}` : "차단됨",
      cls: "border-destructive/50 text-destructive",
      hint: m.last_error,
    };
  }
  if (m?.state === "degraded") {
    return {
      label: `이상 · 실패 ${m.fails} 회`,
      cls: "border-amber-500/50 text-amber-600 dark:text-amber-400",
      hint: m.last_error,
    };
  }
  return { label: "정상", cls: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 폴링 구성抽屉
// ─────────────────────────────────────────────────────────────────────────────

function PoolSheet({
  open,
  onOpenChange,
  pool,
  onReload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pool: LLMPoolStatus | null;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  // 쿨다운倒计时은后端算출력의剩余초数——抽屉开着且있음구성않음정상时才定时拉，让它走起来。
  React.useEffect(() => {
    if (!open || !pool?.enabled || !pool.chain.some((m) => m.state !== "ok")) return;
    const t = setInterval(() => void onReload(), 10_000);
    return () => clearInterval(t);
  }, [open, pool, onReload]);

  async function toggle(patch: { llm_pool_enabled?: boolean; llm_pool_bind_fallback?: boolean }) {
    if (busy) return;
    setBusy(true);
    try {
      await api.setSettings(patch);
      await onReload();
      if (patch.llm_pool_enabled !== undefined) {
        toast.success(patch.llm_pool_enabled ? "LLM 폴링을 켰습니다" : "LLM 폴링을 껐습니다");
      } else {
        toast.success("설정을 업데이트했습니다");
      }
    } catch (e) {
      toast.error(`설정 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function recover(id?: string) {
    try {
      await api.resetLLMPool(id);
      await onReload();
      toast.success(id ? "해당 구성을 복구했습니다" : "모든 구성을 복구했습니다");
    } catch (e) {
      toast.error(`복구 실패: ${(e as Error).message}`);
    }
  }

  const enabled = pool?.enabled ?? false;
  const chain = pool?.chain ?? [];
  // 参와폴링의成员（제외被标记「폴링에 참여하지 않음」의），顺序即后端实际의尝试顺序。
  const inChain = chain.filter((m) => m.active || !m.excluded);
  const tripped = chain.filter((m) => m.state === "tripped");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            <ZapIcon className="size-4" /> LLM 폴링 · 장애 조치
          </SheetTitle>
          <SheetDescription>
            켜면 <b>현재 모델</b>을 사용하는 Agent에서 모든 구성을 사용할 수 없을 때(잔액 부족, 키 만료, 속도 제한,
            서비스 오류 등) 아래의 다음 구성으로 자동 전환합니다.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <Label className="text-sm">폴링 활성화</Label>
              <p className="text-muted-foreground text-xs">기본값은 꺼짐입니다. 꺼져 있으면 활성 구성만 사용하며 실패 시 그대로 실패합니다.</p>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(v) => void toggle({ llm_pool_enabled: v })}
              aria-label="LLM 폴링"
            />
          </div>

          {enabled && (
            <>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label className="text-sm">지정 모델 실패 시에도 대체 구성 사용</Label>
                  <p className="text-muted-foreground text-xs">
                    기본값은 꺼짐입니다. Agent 또는 작업이 특정 구성을 지정하면 해당 구성만 사용하고 실패합니다.
                    켜면 지정된 구성이 실패할 때 아래 폴링 체인으로 대체합니다.
                  </p>
                </div>
                <Switch
                  checked={pool?.bind_fallback ?? false}
                  disabled={busy}
                  onCheckedChange={(v) => void toggle({ llm_pool_bind_fallback: v })}
                  aria-label="지정 구성 실패 시 대체 구성 사용"
                />
              </div>

              <Separator />

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">폴링 순서</Label>
                  {tripped.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => void recover()}>
                      <RotateCcwIcon /> 전체 복구
                    </Button>
                  )}
                </div>
                {inChain.length < 2 && (
                  <p className="text-muted-foreground text-xs">
                     현재 폴링 구성은 {inChain.length}개뿐입니다. API Key가 입력되고 폴링에 참여하는 구성이 최소 2개 필요합니다.
                  </p>
                )}
                {chain.map((m) => {
                  const excluded = m.excluded && !m.active;
                  const order = excluded ? null : inChain.findIndex((x) => x.profile_id === m.profile_id) + 1;
                  return (
                    <div
                      key={m.profile_id}
                      className={cn(
                        "grid gap-1 rounded-lg border p-2.5 text-sm",
                        excluded && "opacity-55",
                        m.state === "tripped" && "border-destructive/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="w-5 shrink-0 text-center font-mono text-muted-foreground text-xs">
                          {order ?? "—"}
                        </span>
                        <span className="font-medium">{m.name}</span>
                        {m.active && (
                          <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                            활성
                          </Badge>
                        )}
                        {excluded && <Badge variant="outline">폴링에 참여하지 않음</Badge>}
                        <div className="ml-auto flex items-center gap-2">
                          {m.state === "tripped" && m.cooldown_secs > 0 && (
                            <span className="text-muted-foreground text-xs">쿨다운 {cooldownText(m.cooldown_secs)}</span>
                          )}
                          {m.state === "degraded" && (
                        <span className="text-muted-foreground text-xs">실패 {m.fails}회</span>
                          )}
                          {m.state !== "ok" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label="즉시 복구"
                              title="즉시 복구: 차단을 해제하고 다음 호출에서 이 구성을 다시 시도합니다"
                              onClick={() => void recover(m.profile_id)}
                            >
                              <RotateCcwIcon className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 pl-7 text-muted-foreground text-xs">
                        <code className="truncate font-mono">{m.model}</code>
                        {!m.active && <span>우선순위 {m.priority}</span>}
                      </div>
                      {m.last_error && (
                        <p className="truncate pl-7 font-mono text-muted-foreground text-xs" title={m.last_error}>
                          {m.last_error}
                        </p>
                      )}
                    </div>
                  );
                })}
                {chain.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
                    구성이 없습니다
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs leading-relaxed">
                활성 구성부터 우선순위가 높은 순서로 시도합니다(각 구성에서 설정). 구성이 실패하면 쿨다운이 적용되며
                60초 → 5분 → 30분으로 늘어납니다. 쿨다운이 끝나면 자동으로 복구됩니다. 컨텍스트 창이 설정되지 않은
                구성은 기본값을 사용합니다. 완료된 모델의 Agent와 작업은 기본적으로 폴링에 참여하지 않습니다.
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 모델 구성抽屉（새로 만들기 / 편집총用同一套表单）
// ─────────────────────────────────────────────────────────────────────────────

function ProfileSheet({
  profile,
  open,
  onOpenChange,
  onSaved,
}: {
  profile: LLMProfile | null; // null = 새로 만들기
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const isNew = !profile;
  const [name, setName] = React.useState("");
  const [format, setFormat] = React.useState<"anthropic" | "openai" | "openai-responses">("anthropic");
  const [model, setModel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [proxy, setProxy] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [keyHint, setKeyHint] = React.useState("");
  const [rps, setRps] = React.useState("0");
  const [rpm, setRpm] = React.useState("0");
  const [cw, setCw] = React.useState("0"); // 컨텍스트 창(K tokens);0=기본값200K
  const [thinkingType, setThinkingType] = React.useState(NONE);
  const [effort, setEffort] = React.useState(NONE);
  const [priority, setPriority] = React.useState("0"); // 폴링顺位;越大越先
  const [poolExclude, setPoolExclude] = React.useState(false);
  const [streaming, setStreaming] = React.useState(true); // true=流式(기본값);false=非流式
  const [maxTokens, setMaxTokens] = React.useState("0"); // 单회응답출력上限;0=전송하지 않음
  const [maxTokensField, setMaxTokensField] = React.useState(NONE); // 上限用哪개字段名;NONE=max_tokens
  const [sessionHeaderKey, setSessionHeaderKey] = React.useState(""); // 사용자 지정会话头名;空=전송하지 않음
  const [retry, setRetry] = React.useState<LLMRetryOverride>(ZERO_OVERRIDE); // 本구성의다시 시도覆盖;全 0=跟随전체
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [models, setModels] = React.useState<string[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [modelsOpen, setModelsOpen] = React.useState(false);

  // 每회打开时从传입력의 profile 灌一遍表单（새로 만들기则重置을 위해기본값值）。抽屉关掉再打开
  // 就은一회干净의시작，않음会留下上한 개구성의残影。
  React.useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setFormat(profile?.format === "openai" || profile?.format === "openai-responses" ? profile.format : "anthropic");
    setModel(profile?.model ?? "");
    setBaseUrl(profile?.base_url ?? "");
    setProxy(profile?.proxy ?? "");
    setRps(String(profile?.rate_per_second ?? 0));
    setRpm(String(profile?.rate_per_minute ?? 0));
    setCw(String(profile?.context_window_k ?? 0));
    setThinkingType(fromStore(profile?.thinking_type));
    setEffort(fromStore(profile?.reasoning_effort));
    setPriority(String(profile?.priority ?? 0));
    setPoolExclude(profile?.pool_exclude ?? false);
    setStreaming(profile?.streaming ?? true);
    setMaxTokens(String(profile?.max_tokens ?? 0));
    setMaxTokensField(fromStore(profile?.max_tokens_field));
    setSessionHeaderKey(profile?.session_header_key ?? "");
    setRetry(profile?.retry ?? ZERO_OVERRIDE);
    setApiKey("");
    setKeyHint(profile?.api_key_hint ?? "");
    setModels([]);
    setModelsOpen(false);
  }, [open, profile]);

  const profileId = profile ? Number(profile.id) : undefined;

  async function loadModels() {
    if (loadingModels) return;
    setLoadingModels(true);
    setModels([]);
    try {
      const r = await api.fetchLLMModels(format, baseUrl, apiKey, proxy, profileId);
      if (r.ok && r.models && r.models.length > 0) {
        setModels(r.models);
        setModelsOpen(true);
        toast.success(`${r.models.length}개 모델을 불러왔습니다`);
      } else {
        toast.error(`모델을 불러오지 못했습니다: ${r.error ?? "모델이 없습니다"}`);
      }
    } catch (e) {
      toast.error(`모델 목록 조회 실패: ${(e as Error).message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    try {
      // 用구성实际会跑의思考参数来测，这样않음支持该字段의모델에서这里就실패，
      // 而않음은等到跑작업时才炸。传 profile id：Key 입력框비워 두면时用已存의 Key。
      const r = await api.testLLM(
        format,
        model,
        baseUrl,
        apiKey,
        proxy,
        toStore(thinkingType),
        toStore(effort),
        profileId,
        streaming,
        sessionHeaderKey.trim(),
      );
      // 응답내용一并展示：看得见모델确实说了话，才算및会话里跑通은一回事。
      if (r.ok)
        toast.success(`연결성공 · ${r.latency_ms ?? "?"}ms · ${r.model ?? model}`, {
          description: r.reply ? `응답: ${r.reply}` : undefined,
        });
      else toast.error(`연결 실패: ${r.error ?? "알 수 없는 오류"}`);
    } catch (e) {
      toast.error(`연결 테스트 실패: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!name.trim() || !model.trim()) {
      toast.error("이름과 모델을 입력해 주세요");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const { id } = await api.saveLLMProfile({
        ...(profile ? { id: Number(profile.id) } : {}),
        name: name.trim(),
        format,
        model: model.trim(),
        base_url: baseUrl.trim(),
        proxy: proxy.trim(),
        api_key: apiKey,
        rate_per_second: Number(rps) || 0,
        rate_per_minute: Number(rpm) || 0,
        context_window_k: Number(cw) || 0,
        thinking_type: toStore(thinkingType),
        reasoning_effort: toStore(effort),
        priority: Number(priority) || 0,
        pool_exclude: poolExclude,
        streaming,
        max_tokens: Math.max(0, Number(maxTokens) || 0),
        // 字段名开关只对 openai(Chat Completions) 있음意义，其它格式一律回落到기본값；
        // 后端也会再做一회同样의归一化，这里只은别让 UI 送출력自相矛盾의值。
        max_tokens_field: format === "openai" ? toStore(maxTokensField) : "",
        session_header_key: sessionHeaderKey.trim(),
        retry,
      });
      if (isNew) toast.success(`${name.trim()} 구성을 만들었습니다. 위의 “활성으로 설정”을 눌러 활성화하세요.`);
      else toast.success(profile?.is_default ? "저장했습니다. 활성 구성이므로 즉시 적용됩니다." : "저장했습니다");
      onSaved(String(id));
      onOpenChange(false);
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:min-w-[420px] data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="px-4">
          <SheetTitle className="flex items-center gap-2">
            {isNew ? "새 모델 구성" : `모델 구성 편집: ${profile?.name}`}
            {profile?.is_default && (
              <Badge variant="outline" className="border-amber-400/50 text-amber-500">
                활성
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {isNew
              ? "새 구성은 자동으로 활성화되지 않습니다. 위의 “활성으로 설정”을 눌러 활성화하세요."
              : "저장하면 활성 구성은 모든 Agent에 즉시 적용됩니다."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="p-name">이름</Label>
              <Input
                id="p-name"
                placeholder="예: OpenAI 기본 구성"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>형식</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "anthropic" | "openai" | "openai-responses")}>
                <SelectTrigger>
                  <SelectValue placeholder="형식 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI (Chat Completions)</SelectItem>
                  <SelectItem value="openai-responses">OpenAI (Responses API)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-model">모델</Label>
            <div className="flex gap-2">
              <Input
                id="p-model"
                className="font-mono"
                placeholder="claude-opus-4-8"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              {/* modal: 这개 Popover 의내용被 portal 到 <body>，에서 Sheet 의滚动锁之外，
                  않음加 modal 时列表能渲染却滚않음动。modal 让它自己持있음最上层滚动锁。 */}
              <Popover open={modelsOpen} onOpenChange={setModelsOpen} modal>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={loadingModels}
                    onClick={loadModels}
                    title="API에서 모델 목록 불러오기"
                  >
                    {loadingModels ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                  </Button>
                </PopoverTrigger>
                {models.length > 0 && (
                  <PopoverContent className="max-h-72 w-72 gap-0 overflow-y-auto overscroll-contain p-1" align="end">
                    {models.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="w-full shrink-0 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          setModel(m);
                          setModelsOpen(false);
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </PopoverContent>
                )}
              </Popover>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-base-url">Base URL (선택 사항)</Label>
            <Input
              id="p-base-url"
              className="font-mono"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-proxy">프록시 (선택 사항)</Label>
            <Input
              id="p-proxy"
              className="font-mono"
              placeholder="socks5://user:pass@127.0.0.1:1080 · http://127.0.0.1:8080"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              LLM 요청에만 사용하는 프록시입니다. http/https/socks5와 사용자 이름·비밀번호 인증을 지원합니다(예:
              socks5://user:pass@host:port). 비밀번호에 특수 문자가 있으면 URL 인코딩이 필요합니다. 비워 두면 프록시를
              사용하지 않고 직접 연결합니다.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-session-header">사용자 지정 세션 헤더 (선택 사항)</Label>
            <Input
              id="p-session-header"
              className="font-mono"
              placeholder="예: x-session-id (비워 두면 전송하지 않음)"
              value={sessionHeaderKey}
              onChange={(e) => setSessionHeaderKey(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              설정하면 모든 HTTP 요청에 이 헤더를 추가하고, <b>현재 세션의 session ID</b>를 자동으로 전달합니다(chat 세션 예:
              conv-12, worker 세션 예: exp3-worker-i87). 서버가 session-id 또는 유사한 헤더를 요구할 때 사용하세요.
              세션마다 값이 달라지므로 세션 간에 공유하지 마세요. 비워 두면 전송하지 않습니다.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="p-api-key">API Key</Label>
            <Input
              id="p-api-key"
              type="password"
              placeholder={keyHint ? `현재 설정됨 (${keyHint}), 비워 두면 유지` : "sk-…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-rps">초당 속도 제한</Label>
              <Input id="p-rps" type="number" min={0} value={rps} onChange={(e) => setRps(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-rpm">분당 속도 제한</Label>
              <Input id="p-rpm" type="number" min={0} value={rpm} onChange={(e) => setRpm(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-cw">컨텍스트 창(K)</Label>
              <Input
                id="p-cw"
                type="number"
                min={0}
                max={1000}
                value={cw}
                onChange={(e) => setCw(e.target.value)}
                placeholder="200"
              />
            </div>
          </div>
          <p className="-mt-2 text-muted-foreground text-xs">
            0 = 제한 없음. 모든 Agent에 적용되는 컨텍스트 창 크기(K tokens)입니다. 0은 기본값 200K를 사용하며 최대
            1000(1M)까지 설정할 수 있습니다. 이 값은 자동 요약을 직접 트리거하지 않습니다.
          </p>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-priority" className="text-sm">
                  폴링 우선순위
                </Label>
                <p className="text-muted-foreground text-xs">
                  숫자가 클수록 먼저 선택됩니다. 활성 구성은 항상 1순위이며 이 값의 영향을 받지 않습니다. 우선순위가
                  같은 구성은 이름순으로 정렬됩니다.
                </p>
              </div>
              <Input
                id="p-priority"
                type="number"
                className="w-24 shrink-0"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">폴링에 참여하지 않음</Label>
                <p className="text-muted-foreground text-xs">
                  켜면 장애 조치 대상에서 제외됩니다(Agent와 작업에서 사용). 단일 Agent가 실패해도 이 구성으로
                  대체하지 않습니다.
                </p>
              </div>
              <Switch checked={poolExclude} onCheckedChange={setPoolExclude} aria-label="폴링에 참여하지 않음" />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">스트리밍 출력 · streaming</Label>
                <p className="text-muted-foreground text-xs">
                  켜면(기본값) SSE를 사용해 실행 중 생성되는 token을 실시간으로 표시합니다. 끄면
                  (stream: false) 응답을 한 번에 받으므로 SSE가 제공하는 실시간 출력(빈 응답/추론 필드 포함)을
                  사용할 수 없습니다.
                </p>
              </div>
              <Switch checked={streaming} onCheckedChange={setStreaming} aria-label="출력" />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor="p-max-tokens" className="text-sm">
                  출력 상한 · max tokens
                </Label>
                <p className="text-muted-foreground text-xs">
                  한 번의 응답에서 생성할 수 있는 최대 token 수입니다. 0(기본값)은 해당 필드를 보내지 않고 서비스
                  기본값을 사용합니다. 위의 “컨텍스트 창”은 모델 대화 전체의 크기이고, 이 값은 한 번의 출력 길이만
                  제한합니다. 추론 모델에서는 모델이 실제 출력 한도를 별도로 계산할 수 있습니다.
                </p>
              </div>
              <Input
                id="p-max-tokens"
                type="number"
                min={0}
                className="w-28 shrink-0"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">상한 필드 이름</Label>
                <p className="text-muted-foreground text-xs">{MAX_TOKENS_FIELD_HINTS[format]}</p>
              </div>
              <Select
                value={format === "openai" ? maxTokensField : NONE}
                onValueChange={setMaxTokensField}
                disabled={format !== "openai"}
              >
                <SelectTrigger className="w-56 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_TOKENS_FIELDS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <Label className="text-sm">추론 스위치 · thinking.type</Label>
                <p className="text-muted-foreground text-xs">
                  thinking 필드의 동작입니다. 전송하지 않음은 필드를 보내지 않는 상태이며(일부 MiniMax 외 모델은
                  지원하지 않음), 꺼짐은 disabled, 켜짐은 enabled를 전송합니다. 아래의 추론 강도와는 독립적입니다.
                </p>
              </div>
              <Select value={thinkingType} onValueChange={setThinkingType}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_TYPES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="grid gap-0.5">
                <Label className="text-sm">추론 강도 · reasoning_effort</Label>
                <p className="text-muted-foreground text-xs">
                  추론 강도입니다(OpenAI reasoning_effort / Anthropic output_config.effort). thinking 필드가 없어도
                  강도만으로 추론을 활성화하는 API가 있으므로 독립적으로 설정합니다. 전송하지 않음을 선택하면 이 필드를
                  보내지 않습니다.
                </p>
              </div>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EFFORT_LEVELS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ProfileRetryFields value={retry} onChange={setRetry} />
        </div>

        <div className="flex gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            {testing ? "테스트 중…" : "연결 테스트"}
          </Button>
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving && <Loader2Icon className="animate-spin" />}
            {!saving && (isNew ? <PlusIcon /> : <SaveIcon />)}
            {isNew ? "새로 만들기" : "저장"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LLMPage() {
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [pool, setPool] = React.useState<LLMPoolStatus | null>(null);
  const [poolOpen, setPoolOpen] = React.useState(false);
  // 抽屉의开关및내용分开存：꺼짐时 editing 保持않음变，그렇지 않으면꺼짐动画期间标题会从
  // 「편집 X」闪成「새로 만들기」。editing = null 의미새로 만들기。
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LLMProfile | null>(null);
  const openEditor = React.useCallback((p: LLMProfile | null) => {
    setEditing(p);
    setEditOpen(true);
  }, []);

  const loadPool = React.useCallback(async () => {
    try {
      setPool(await api.llmPool());
    } catch {
      /* ignore */
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      setProfiles(await api.llmProfiles());
    } catch {
      /* ignore */
    }
    await loadPool();
  }, [loadPool]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 卡片上의健康徽章按 profile id 取폴링상태。
  const health = React.useMemo(() => {
    const m = new Map<string, LLMPoolMember>();
    for (const c of pool?.chain ?? []) m.set(c.profile_id, c);
    return m;
  }, [pool]);

  async function activate(id: string, name: string) {
    try {
      await api.activateLLMProfile(id);
      toast.success(`${name} 구성을 활성화했습니다`);
      await load();
    } catch (e) {
      toast.error(`활성화 실패: ${(e as Error).message}`);
    }
  }

  async function remove(p: LLMProfile) {
    if (p.is_default) {
      toast.error("현재 활성 구성은 삭제할 수 없습니다");
      return;
    }
    try {
      await api.deleteLLMProfile(p.id);
      toast.success(`삭제했습니다: ${p.name}`);
      await load();
    } catch (e) {
      toast.error(`삭제 실패: ${(e as Error).message}`);
    }
  }

  const poolOn = pool?.enabled ?? false;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">LLM</h1>
          <p className="text-muted-foreground text-sm">모든 Agent에서 사용할 형식, 모델, 연결 구성을 관리합니다. 편집하고 활성 구성을 선택하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPoolOpen(true)}>
            <ZapIcon /> 폴링 구성
            {poolOn && (
              <Badge variant="outline" className="ml-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
                켜짐
              </Badge>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openEditor(null)}>
            <PlusIcon /> 새로 만들기
          </Button>
        </div>
      </div>

      <Tabs defaultValue="profiles" className="flex-1">
        <TabsList>
          <TabsTrigger value="profiles">모델 구성</TabsTrigger>
          <TabsTrigger value="retry">재시도 및 백오프</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => {
              const h = healthOf(p, health.get(p.id));
              return (
                // biome-ignore lint/a11y/useSemanticElements: 卡片内含自己의작업按钮，用原生 <button> 会造成按钮嵌套（非法 HTML）
                <Card
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditor(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEditor(p);
                    }
                  }}
                  className={cn(
                    "cursor-pointer gap-0 py-4 outline-none transition-colors hover:border-foreground/30",
                    p.is_default && "border-amber-400/50 bg-amber-400/5",
                  )}
                >
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex items-start gap-2">
                      <StarIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          p.is_default ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">{p.name}</span>
                          <Badge variant="outline" className="uppercase">
                            {p.format}
                          </Badge>
                          <Badge variant="outline" className={cn("ml-auto", h.cls)} title={h.hint}>
                            {h.label}
                          </Badge>
                        </div>
                        <code className="mt-1 block truncate font-mono text-muted-foreground text-xs">{p.model}</code>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-muted-foreground text-xs">
                      {p.api_key_hint && <span>{p.api_key_hint}</span>}
                      <span>
                        {p.rate_per_second}/s · {p.rate_per_minute}/min
                      </span>
                      {p.proxy && <span className="truncate">프록시 {p.proxy}</span>}
                      {p.reasoning_effort && (
                        <span>추론 {p.reasoning_effort === "off" ? "" : p.reasoning_effort}</span>
                      )}
                      {/* 폴링관련의개필드만에서폴링 시있음， 시않음 */}
                      {poolOn &&
                        !p.is_default &&
                        (p.pool_exclude ? <span>폴링에 참여하지 않음</span> : <span>우선순위 {p.priority ?? 0}</span>)}
                    </div>

                    <div className="mt-1 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={p.is_default}
                        onClick={(e) => {
                          e.stopPropagation();
                          void activate(p.id, p.name);
                        }}
                      >
                        {p.is_default ? "활성화됨" : "활성으로 설정"}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="구성 삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(p);
                        }}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {profiles.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-muted-foreground text-sm">
                모델 구성이 없습니다. 오른쪽 위의 “새로 만들기”를 클릭해 첫 구성을 생성하세요.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="retry" className="mt-4">
          <RetryPolicyPanel />
        </TabsContent>
      </Tabs>

      <ProfileSheet profile={editing} open={editOpen} onOpenChange={setEditOpen} onSaved={() => void load()} />
      <PoolSheet open={poolOpen} onOpenChange={setPoolOpen} pool={pool} onReload={loadPool} />
    </div>
  );
}
