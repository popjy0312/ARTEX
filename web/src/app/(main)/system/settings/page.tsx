"use client";

import * as React from "react";

import { CpuIcon, FlaskConicalIcon, KeyboardIcon, RadioTowerIcon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { CHAT_SEND_MODE_OPTIONS, type ChatSendMode, setChatSendMode, useChatSendMode } from "@/lib/chat-send-mode";
import type { Settings } from "@/lib/types";

export default function SystemSettingsPage() {
  const [trafficCapture, setTrafficCapture] = React.useState(false);
  const [agentTrafficBinding, setAgentTrafficBinding] = React.useState(false);
  const [webSearch, setWebSearch] = React.useState(false);
  const [backend, setBackend] = React.useState("ddgs");
  const [braveKeySet, setBraveKeySet] = React.useState(false);
  const [braveKeyInput, setBraveKeyInput] = React.useState("");
  const [tavilyKeySet, setTavilyKeySet] = React.useState(false);
  const [tavilyKeyInput, setTavilyKeyInput] = React.useState("");
  const [savingTavilyKey, setSavingTavilyKey] = React.useState(false);
  const [proxyInput, setProxyInput] = React.useState("");
  const [savingProxy, setSavingProxy] = React.useState(false);
  const [globalProxyInput, setGlobalProxyInput] = React.useState("");
  const [savingGlobalProxy, setSavingGlobalProxy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState(false);
  const [pyInterp, setPyInterp] = React.useState("");
  const [workers, setWorkers] = React.useState("3");
  const [savingWorkers, setSavingWorkers] = React.useState(false);
  // 작업입력범위(기본값)
  const [injectPlanner, setInjectPlanner] = React.useState(true);
  const [injectWorker, setInjectWorker] = React.useState(true);
  // :noa (기본값)
  const [noaCompaction, setNoaCompaction] = React.useState(false);
  //  전：않음 /api/settings， localStorage
  const sendMode = useChatSendMode();

  const apply = React.useCallback((s: Settings) => {
    setTrafficCapture(!!s.traffic_capture);
    setAgentTrafficBinding(!!s.agent_traffic_binding);
    setWebSearch(false);
    setBackend(s.web_search_backend || "ddgs");
    setBraveKeySet(!!s.brave_key_set);
    setTavilyKeySet(!!s.tavily_key_set);
    setProxyInput(s.web_search_proxy ?? "");
    setGlobalProxyInput(s.global_proxy ?? "");
    setPyInterp(s.python_interpreter ?? "");
    setWorkers(String(s.workers ?? 3));
    setInjectPlanner(s.constraints_inject_planner !== false);
    setInjectWorker(s.constraints_inject_worker !== false);
    setNoaCompaction(!!s.noa_compaction);
  }, []);

  const saveWorkers = () => {
    const n = Number(workers);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error("동시성은 0보다 큰 정수여야 합니다");
      return;
    }
    setSavingWorkers(true);
    api
      .setSettings({ workers: n })
      .then((s) => {
        apply(s);
        toast.success("작업 Agent 동시성을 저장했습니다(새로 시작하는 작업부터 적용)");
      })
      .catch((e) => toast.error("저장 실패: " + (e as Error).message))
      .finally(() => setSavingWorkers(false));
  };

  const savePython = () => {
    setSaving(true);
    api
      .setSettings({ python_interpreter: pyInterp.trim() })
      .then((s) => {
        apply(s);
        toast.success("Python 인터프리터 구성을 저장했습니다");
      })
      .catch((e) => toast.error("저장 실패: " + (e as Error).message))
      .finally(() => setSaving(false));
  };
  const detectPython = () => {
    setSaving(true);
    api
      .detectPython()
      .then((r) => setPyInterp(r.python_interpreter))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  React.useEffect(() => {
    api
      .settings()
      .then(apply)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [apply]);

  const toggleTraffic = (v: boolean) => {
    setTrafficCapture(v); // optimistic
    setSaving(true);
    api
      .setSettings({ traffic_capture: v })
      .then(apply)
      .catch(() => setTrafficCapture(!v)) // revert on failure
      .finally(() => setSaving(false));
  };

  const toggleInjectPlanner = (v: boolean) => {
    setInjectPlanner(v); // optimistic
    api
      .setSettings({ constraints_inject_planner: v })
      .then(apply)
      .catch(() => setInjectPlanner(!v)); // revert on failure
  };

  const toggleAgentTrafficBinding = (v: boolean) => {
    setAgentTrafficBinding(v);
    setSaving(true);
    api
      .setSettings({ agent_traffic_binding: v })
      .then((s) => {
        apply(s);
        toast.success(v ? "Agent 트래픽 자동 연결을 켰습니다" : "Agent 트래픽 자동 연결을 껐습니다");
      })
      .catch((e) => {
        setAgentTrafficBinding(!v);
        toast.error(`저장 실패: ${(e as Error).message}`);
      })
      .finally(() => setSaving(false));
  };

  const toggleInjectWorker = (v: boolean) => {
    setInjectWorker(v); // optimistic
    api
      .setSettings({ constraints_inject_worker: v })
      .then(apply)
      .catch(() => setInjectWorker(!v)); // revert on failure
  };

  const toggleNoaCompaction = (v: boolean) => {
    setNoaCompaction(v); // optimistic
    api
      .setSettings({ noa_compaction: v })
      .then((s) => {
        apply(s);
        toast.success(
          v
            ? "noa 컨텍스트 압축을 켰습니다(새로 시작하는 실행부터 적용)"
            : "noa 컨텍스트 압축을 껐습니다(내장 압축으로 복구)",
        );
      })
      .catch((e) => {
        setNoaCompaction(!v); // revert on failure
        toast.error(`저장 실패: ${(e as Error).message}`);
      });
  };

  // Persist a web-search patch (enable and/or backend). Optimistic with refetch.
  const saveWebSearch = (patch: Partial<Settings>) => {
    setSaving(true);
    api
      .setSettings(patch)
      .then((s) => {
        apply(s);
        toast.success("웹 검색 구성을 저장했습니다");
      })
      .catch((e) => {
        toast.error("저장 실패: " + (e as Error).message);
        api
          .settings()
          .then(apply)
          .catch(() => undefined);
      })
      .finally(() => setSaving(false));
  };

  const saveBraveKey = () => {
    setSavingKey(true);
    api
      .setSettings({ brave_search_api_key: braveKeyInput })
      .then((s) => {
        apply(s);
        setBraveKeyInput("");
        toast.success("Brave API Key를 저장했습니다");
      })
      .catch((e) => toast.error("저장 실패: " + (e as Error).message))
      .finally(() => setSavingKey(false));
  };

  const saveTavilyKey = () => {
    setSavingTavilyKey(true);
    api
      .setSettings({ tavily_search_api_key: tavilyKeyInput })
      .then((s) => {
        apply(s);
        setTavilyKeyInput("");
        toast.success("Tavily API Key를 저장했습니다");
      })
      .catch((e) => toast.error("저장 실패: " + (e as Error).message))
      .finally(() => setSavingTavilyKey(false));
  };

  const saveProxy = () => {
    setSavingProxy(true);
    api
      .setSettings({ web_search_proxy: proxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(
          proxyInput.trim() ? "웹 검색 프록시를 저장했습니다" : "웹 검색 프록시를 삭제했습니다(직접 연결로 변경)",
        );
      })
      .catch((e) => toast.error("저장 실패: " + (e as Error).message))
      .finally(() => setSavingProxy(false));
  };

  const saveGlobalProxy = () => {
    setSavingGlobalProxy(true);
    api
      .setSettings({ global_proxy: globalProxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(
          globalProxyInput.trim()
            ? "전체 Agent 프록시를 저장했습니다"
            : "전체 Agent 프록시를 삭제했습니다(직접 연결로 변경)",
        );
      })
      .catch((e) => toast.error("저장 실패: " + (e as Error).message))
      .finally(() => setSavingGlobalProxy(false));
  };

  // Run a real "test" search ("test") against the CURRENT form values (backend +
  // proxy + entered key), falling back to saved values server-side. Toasts result.
  const runTest = () => {
    setTesting(true);
    api
      .testWebSearch({
        web_search_backend: backend,
        web_search_proxy: proxyInput.trim(),
        brave_search_api_key: braveKeyInput,
        tavily_search_api_key: tavilyKeyInput,
      })
      .then((r) => {
        if (r.ok) toast.success(`검색 테스트 성공 · ${r.backend}에서 ${r.count}개 결과를 반환했습니다`);
        else toast.error("검색 테스트 실패: " + (r.error || "알 수 없는 오류"));
      })
      .catch((e) => toast.error("검색 테스트 실패: " + (e as Error).message))
      .finally(() => setTesting(false));
  };

  // brave-free selected but no key stored and none being entered → tool stays off.
  const braveNeedsKey = webSearch && backend === "brave-free" && !braveKeySet;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">시스템 설정</h1>
        <p className="text-muted-foreground text-sm">모든 실행에 적용되는 전역 설정</p>
      </div>

      {/*  grid：검색，（brave/tavily
          의 key 입력은개）grid 의줄에서，
          자동내용 mb  gap——
          column-gap ，줄 */}
      <div className="columns-1 gap-4 md:gap-6 lg:columns-2">
        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              트래픽 캡처
            </CardTitle>
            <CardDescription>
              켜면 모든 Agent의 HTTP 트래픽을 기록 프록시를 통해 저장하고, Agent에 traffic_search / traffic_get 도구와
              프록시 설정(프롬프트에 프록시 안내 포함)을 주입합니다.
              <br />
              끄면(기본값) 트래픽을 기록하지 않습니다. Agent에는 프록시 설정과 트래픽 도구가 제공되지 않으며,
              프롬프트에도 프록시 관련 내용이 포함되지 않습니다. 변경 사항은 Agent를 즉시 다시 구성해 적용합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="traffic-capture" className="text-sm font-normal text-muted-foreground">
              {trafficCapture ? "켜짐 · 트래픽을 기록하고 Agent에 주입" : "꺼짐 · 기록하지 않고 Agent에 주입하지 않음"}
            </Label>
            <Switch
              id="traffic-capture"
              checked={trafficCapture}
              disabled={!loaded || saving}
              onCheckedChange={toggleTraffic}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              Agent 트래픽 자동 연결
            </CardTitle>
            <CardDescription id="agent-traffic-binding-description">
              기본값은 꺼짐입니다. 켜면 취약점이 저장될 때 실행되는 보고서 Agent가 기존 HTTP 요청/응답을 확인하고,
              일치하는 트래픽을 연결한 뒤 보고서를 작성합니다.{" "}
              <b>패킷 조회와 추가 도구 호출로 Token 사용량이 늘어납니다.</b>
              <br />
              TCP 트래픽, 캡처되지 않은 트래픽 또는 일치하는 트래픽이 없는 경우에도 정상적으로 보고할 수 있습니다. 이
              설정은 트래픽 캡처, 수동 연결, 저장된 증거 조회에는 영향을 주지 않습니다. 다음 Agent 실행부터 적용되며,
              끄면 새로운 자동 연결을 즉시 차단합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="agent-traffic-binding" className="text-sm font-normal text-muted-foreground">
              {agentTrafficBinding ? "켜짐 · 토큰 사용량 증가" : "꺼짐 · 수동 연결 가능"}
            </Label>
            <Switch
              id="agent-traffic-binding"
              aria-describedby="agent-traffic-binding-description"
              checked={agentTrafficBinding}
              disabled={!loaded || saving}
              onCheckedChange={toggleAgentTrafficBinding}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              전체 프록시
            </CardTitle>
            <CardDescription>
              모든 Agent의 <b>대상 트래픽</b>을 이 프록시를 통해 외부로 전송합니다(원본 IP 숨김 또는 점프 호스트 사용).
              <b>http / https / socks5</b>를 지원하며 <code>user:pass</code> 인증을 사용할 수 있습니다. 비워 두면 직접
              연결합니다.
              <br />
              <b>트래픽 캡처</b>를 켜면 이 프록시는 기록 프록시의 <b>상위 프록시</b>로 사용됩니다(트래픽은 모두 저장한
              뒤 이 프록시를 통해 전송). 캡처를 끄면 Agent의 bash / WebFetch가 직접 외부로 연결합니다. 웹 검색 프록시와
              LLM 프록시에는 영향을 주지 않습니다.
              <br />
              <b>참고</b>: 캡처를 끈 상태의 socks5는 명령줄 도구가 <code>ALL_PROXY</code>를 지원해야 합니다(curl은
              지원하지만 일부 도구는 무시할 수 있음). socks5를 주로 사용한다면 트래픽 캡처를 켜는 것이 좋습니다. 이
              경로는 MITM이 직접 연결하므로 도구가 프록시를 인식하지 않아도 안정적으로 적용됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="global-proxy" className="text-sm font-normal text-muted-foreground">
              프록시 주소
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="global-proxy"
                autoComplete="off"
                placeholder="socks5://user:pass@host:1080 또는 http://host:port (비워 두면 직접 연결)"
                value={globalProxyInput}
                disabled={!loaded || savingGlobalProxy}
                onChange={(e) => setGlobalProxyInput(e.target.value)}
              />
              <Button type="button" onClick={saveGlobalProxy} disabled={!loaded || savingGlobalProxy}>
                저장
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {globalProxyInput.trim()
                ? "설정됨 · 모든 대상 트래픽이 이 프록시를 통해 전송됨"
                : "설정되지 않음 · 대상 트래픽 직접 연결"}
            </p>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlertIcon className="size-4" />
              작업 제약 주입
            </CardTitle>
            <CardDescription>
              켜면 각 작업의 <b>작업 제약</b>(작업 개요의 “작업 제약”에서 관리하는 allow/deny 항목)을 해당 Agent의
              시스템 프롬프트에 추가해 탐색 범위를 제한합니다(예: “현재 포트만 테스트”, “무차별 대입 금지”).
              <br />
              <b>플래너(planner)</b>와 <b>워커(worker)</b>에 각각 주입할 수 있습니다. 기본값은 모두 켜짐이며, 변경
              사항은 다음 실행부터 즉시 적용되고 Agent를 다시 구성할 필요가 없습니다. 끄면 해당 Agent가 제약을 받지
              않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-planner" className="text-sm font-normal text-muted-foreground">
                플래너 주입(planner){injectPlanner ? " · 켜짐" : " · 꺼짐"}
              </Label>
              <Switch
                id="inject-planner"
                checked={injectPlanner}
                disabled={!loaded}
                onCheckedChange={toggleInjectPlanner}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-worker" className="text-sm font-normal text-muted-foreground">
                워커 주입(worker){injectWorker ? " · 켜짐" : " · 꺼짐"}
              </Label>
              <Switch
                id="inject-worker"
                checked={injectWorker}
                disabled={!loaded}
                onCheckedChange={toggleInjectWorker}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConicalIcon className="size-4" />
              실험 기능
            </CardTitle>
            <CardDescription>
              아직 검증 중인 기능이며 기본값은 꺼짐입니다. Agent 동작이나 안정성에 영향을 줄 수 있으므로 영향을 이해한
              후에 활성화하세요.
              <br />
              <b>noa 컨텍스트 압축</b>: 모델이 긴 대화 기록을 능동적으로 압축합니다(norma v0.4.0). 켜면 플랫폼이
              사용하는 네 가지 Agent(<b>플래너 / 워커 / 메인 Agent / 대화</b>)가 내장 압축 대신 noa로 컨텍스트를
              관리하며, 압축된 원문은 작업 디렉터리에 보관해 추적할 수 있습니다. 다음 실행부터 적용되고 Agent를 다시
              구성할 필요가 없습니다. 끄면 내장 압축으로 즉시 돌아갑니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="noa-compaction" className="text-sm font-normal text-muted-foreground">
              noa 컨텍스트 압축{noaCompaction ? " · 켜짐" : " · 꺼짐"}
            </Label>
            <Switch
              id="noa-compaction"
              checked={noaCompaction}
              disabled={!loaded}
              onCheckedChange={toggleNoaCompaction}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SearchIcon className="size-4" />
              검색
            </CardTitle>
            <CardDescription>
              외부 검색 서비스로 작업 내용이 전송되는 것을 막기 위해 웹 검색은 보안 정책상 비활성화되어 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="web-search" className="text-sm font-normal text-muted-foreground">
                {webSearch ? "켜짐 · 각 Agent 구성에서 활성화 가능" : "꺼짐 · Agent별 웹 검색을 사용할 수 없음"}
              </Label>
              <Switch id="web-search" checked={false} disabled />
            </div>

            {webSearch && (
              <div className="flex items-center justify-between gap-4">
                <Label className="text-sm font-normal text-muted-foreground">검색 소스</Label>
                <Select
                  value={backend}
                  disabled={!loaded || saving}
                  onValueChange={(v) => {
                    setBackend(v); // optimistic
                    saveWebSearch({ web_search_backend: v });
                  }}
                >
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue placeholder="소스 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ddgs">DuckDuckGo(ddgs · Key 불필요)</SelectItem>
                    <SelectItem value="brave-free">Brave(무료 버전 · Key 필요)</SelectItem>
                    <SelectItem value="tavily">Tavily(Key 필요)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {webSearch && backend === "brave-free" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="brave-key" className="text-sm font-normal text-muted-foreground">
                  Brave Search API Key
                  {braveKeySet && <span className="ml-2 text-xs text-emerald-500">구성됨</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="brave-key"
                    type="password"
                    autoComplete="off"
                    placeholder={braveKeySet ? "구성됨(비워 두면 유지)" : "Brave API Key 입력"}
                    value={braveKeyInput}
                    disabled={!loaded || savingKey}
                    onChange={(e) => setBraveKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveBraveKey}
                    disabled={!loaded || savingKey || braveKeyInput.trim() === ""}
                  >
                    저장
                  </Button>
                </div>
                {braveNeedsKey && (
                  <p className="text-xs text-amber-500">
                    Brave를 선택했지만 아직 Key가 설정되지 않았습니다. Key를 저장하기 전에는 검색 도구가 활성화되지
                    않습니다.
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  무료 버전은 월 2,000회까지 제공됩니다. https://brave.com/search/api/ 에서 Key를 발급받으세요.
                </p>
              </div>
            )}

            {webSearch && backend === "tavily" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="tavily-key" className="text-sm font-normal text-muted-foreground">
                  Tavily Search API Key
                  {tavilyKeySet && <span className="ml-2 text-xs text-emerald-500">구성됨</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tavily-key"
                    type="password"
                    autoComplete="off"
                    placeholder={tavilyKeySet ? "구성됨(비워 두면 유지)" : "Tavily API Key 입력(tvly-…)"}
                    value={tavilyKeyInput}
                    disabled={!loaded || savingTavilyKey}
                    onChange={(e) => setTavilyKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveTavilyKey}
                    disabled={!loaded || savingTavilyKey || tavilyKeyInput.trim() === ""}
                  >
                    저장
                  </Button>
                </div>
                {webSearch && backend === "tavily" && !tavilyKeySet && (
                  <p className="text-xs text-amber-500">
                    Tavily를 선택했지만 아직 Key가 설정되지 않았습니다. Key를 저장하기 전에는 검색 도구가 활성화되지
                    않습니다.
                  </p>
                )}
                <p className="text-muted-foreground text-xs">https://tavily.com 에 가입하고 API Key를 발급받으세요.</p>
              </div>
            )}

            {webSearch && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-proxy" className="text-sm font-normal text-muted-foreground">
                  출구 프록시(선택 사항)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ws-proxy"
                    autoComplete="off"
                    placeholder="http://host:port 또는 socks5://host:port(비워 두면 직접 연결)"
                    value={proxyInput}
                    disabled={!loaded || savingProxy}
                    onChange={(e) => setProxyInput(e.target.value)}
                  />
                  <Button type="button" onClick={saveProxy} disabled={!loaded || savingProxy}>
                    저장
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  검색 endpoint에만 사용하는 독립적인 출구 프록시입니다(VPN/SOCKS 등). 트래픽을 기록하는 MITM 프록시와는
                  무관하며, 네트워크가 연결되지 않을 때 이 프록시를 통해 접속합니다.
                </p>
              </div>
            )}

            {webSearch && (
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <p className="text-muted-foreground text-xs">
                  현재 설정(소스 + 프록시 + Key)으로 “test”를 한 번 검색해 사용 가능 여부를 확인합니다.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runTest}
                  disabled={!loaded || testing}
                  className="shrink-0"
                >
                  {testing ? "테스트 중…" : "검색 테스트"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              사용자 지정 스크립트 · Python 인터프리터
            </CardTitle>
            <CardDescription>
              사용자 지정 <b>script</b> 유형 도구를 Python으로 실행합니다. 시작할 때 자동으로 감지합니다(python3 우선).
              이곳에 venv 또는 특정 버전의 절대 경로를 입력할 수 있으며, 비워 두면 실행 시 자동으로 감지합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                className="font-mono text-sm"
                placeholder="/usr/bin/python3 (비워 두면 자동 감지)"
                value={pyInterp}
                disabled={!loaded || saving}
                onChange={(e) => setPyInterp(e.target.value)}
              />
              <Button variant="outline" onClick={detectPython} disabled={!loaded || saving}>
                다시 감지
              </Button>
              <Button onClick={savePython} disabled={!loaded || saving}>
                저장
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CpuIcon className="size-4" />
              작업 동시성 · Work Agent 수
            </CardTitle>
            <CardDescription>
              작업마다 동시에 실행할 Work Agent 수입니다(기본값 3). 값이 클수록 동시에 더 많은 탐색을 수행하지만
              사용량도 증가합니다. 변경 사항은 <b>이후 시작하는 작업</b>에 적용되며, 실행 중인 작업에는 영향을 주지
              않습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                className="w-32 font-mono text-sm"
                placeholder="3"
                value={workers}
                disabled={!loaded || savingWorkers}
                onChange={(e) => setWorkers(e.target.value)}
              />
              <Button onClick={saveWorkers} disabled={!loaded || savingWorkers}>
                저장
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyboardIcon className="size-4" />
              세션 입력 전송 방식
            </CardTitle>
            <CardDescription>
              대화 페이지와 작업 상세의 메인 Agent 세션 입력란에서 함께 사용하는 설정입니다. 선택하면 즉시 적용되며
              저장할 필요가 없습니다.
              <br />이 설정은 <b>현재 브라우저에만 저장</b>되며 계정과 동기화되지 않습니다. 브라우저를 바꾸거나 사이트
              데이터를 삭제하면 다시 설정해야 합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="chat-send-mode" className="text-sm font-normal text-muted-foreground">
              전송 방식
            </Label>
            <Select value={sendMode} onValueChange={(v) => setChatSendMode(v as ChatSendMode)}>
              <SelectTrigger id="chat-send-mode" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_SEND_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
