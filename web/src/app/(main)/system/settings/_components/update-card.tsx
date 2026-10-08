"use client";

import * as React from "react";

import {
  CheckCircle2Icon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api, sseUrl } from "@/lib/api";
import type { UpdateCheck, UpdateProgress } from "@/lib/types";

/** 외待새 버전上线의最长时间。一회升级要经过三회进程启动（暂存 → 换装 → 새 버전），
 *  每회都은초级，三분足够覆盖慢磁盘및 Docker 容器重建。 */
const RESTART_TIMEOUT_MS = 180_000;

function humanSize(n?: number): string {
  if (!n || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function UpdateCard() {
  const [info, setInfo] = React.useState<UpdateCheck | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [progress, setProgress] = React.useState<UpdateProgress | null>(null);
  // 와 progress 分开：暂存완료后进程就没了，SSE 会断，此时要切到폴링 /api/health。
  const [restarting, setRestarting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // quiet 同时决定要않음要绕过后端缓存：进页面时의자동检查用缓存（顶栏刚查过），
  // 사용자수동点「업데이트 확인」则强制回源，그렇지 않으면刚发布의버전要等缓存过期才看得到。
  const check = React.useCallback((quiet = false) => {
    setChecking(true);
    api
      .checkUpdate(!quiet)
      .then((r) => {
        setInfo(r);
        if (!quiet) {
          if (r.error) toast.error("업데이트를 확인하지 못했습니다: " + r.error);
          else if (r.has_update) toast.success(`새 버전이 있습니다: ${r.latest}`);
          else if (r.comparable) toast.success("최신 버전을 사용 중입니다.");
        }
      })
      .catch((e) => {
        if (!quiet) toast.error("업데이트를 확인하지 못했습니다: " + (e as Error).message);
      })
      .finally(() => setChecking(false));
  }, []);

  React.useEffect(() => {
    check(true);
  }, [check]);

  // 폴링 /api/health 直到버전号变化。
  //
  // 判据必须은"버전变了"而않음은"能连上了"：换装过程中이전 버전本会短暂地重新起来一회
  // （那一회只负责把 artex.new 换上去然后立刻退출력），只看连通性会误判성공。
  const waitForNewVersion = React.useCallback(async (fromVersion: string) => {
    setRestarting(true);
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { version?: string };
          if (j.version && j.version !== fromVersion) {
            toast.success(`${j.version}(으)로 업데이트했습니다. 페이지를 새로 고칩니다.`);
            await sleep(800);
            window.location.reload();
            return;
          }
        }
      } catch {
        // 重启窗口内连않음上은预期의，继续폴링。
      }
    }
    setRestarting(false);
    toast.error("서비스 재시작 시간이 초과되었습니다. 로그를 확인하거나 artex의 start.sh / start.bat를 직접 실행해 주세요.");
  }, []);

  // 订阅업데이트进度。SSE 않음走 Next 의 /api 重写（那层会缓冲，事件推않음출력来）。
  const openStream = React.useCallback(
    (fromVersion: string) => {
      const es = new EventSource(sseUrl("/api/update/stream"));
      es.onmessage = (ev) => {
        let p: UpdateProgress;
        try {
          p = JSON.parse(ev.data) as UpdateProgress;
        } catch {
          return;
        }
        setProgress(p);
        if (p.phase === "failed") {
          es.close();
          setBusy(false);
          toast.error("업데이트에 실패했습니다: " + (p.error || p.message));
          return;
        }
        if (p.phase === "staged") {
          es.close();
          void waitForNewVersion(fromVersion);
        }
      };
      es.onerror = () => {
        // 进程退출력时 SSE 必然연결 해제。만약已经进입력等待重启，这属于정상现象，
        // 交给 /api/health 폴링继续判定即可。
        es.close();
      };
      return es;
    },
    [waitForNewVersion],
  );

  const doUpdate = () => {
    if (!info) return;
    const from = info.current;
    const ok = window.confirm(
      `버전 ${info.latest}(으)로 업데이트할까요?\n\n` +
        "업데이트 중 프로그램이 재시작되며 실행 중인 작업이 일시 중지될 수 있습니다.\n" +
        (info.mode === "docker"
          ? "\n주의: 프로그램만 업데이트되며 playwright, nmap 등의 도구는 업데이트되지 않습니다. " +
            "도구를 업데이트하려면 docker compose pull을 실행하세요."
          : ""),
    );
    if (!ok) return;

    setBusy(true);
    setProgress({ phase: "downloading", percent: 0, message: " 중…" });
    const es = openStream(from);
    api.applyUpdate().catch((e) => {
      es.close();
      setBusy(false);
      setProgress(null);
      toast.error("업데이트에 실패했습니다: " + (e as Error).message);
    });
  };

  const doRollback = () => {
    if (!info) return;
    if (
      !window.confirm(
        "이전 버전으로 되돌릴까요?\n\n프로그램이 재시작되며 실행 중인 작업이 일시 중지될 수 있습니다.\n주의: 데이터는 영향을 받지 않지만 새 버전에서 생성된 데이터는 이전 버전에서 지원되지 않을 수 있습니다.",
      )
    )
      return;
    const from = info.current;
    setBusy(true);
    api
      .rollbackUpdate()
      .then(() => {
        toast.success("이전 버전으로 되돌렸습니다. 재시작합니다…");
        void waitForNewVersion(from);
      })
      .catch((e) => {
        setBusy(false);
        toast.error("롤백에 실패했습니다: " + (e as Error).message);
      });
  };

  const phase = progress?.phase;
  const showProgress = busy || restarting;
  // 只있음다운로드阶段拿得到真实百分比（按 Content-Length 算）。校验/解压/等待重启都은
  // 时长않음可知의阶段，进度개填满并加개脉冲动画의미"에서忙但说않음准还要多久"。
  const downloading = !restarting && phase === "downloading";
  const pct = downloading ? Math.max(progress?.percent ?? 0, 0) : 100;

  return (
    // 설정页은多列瀑布流布局，卡片自己负责줄间距并차단跨列연결 해제（见 page.tsx 의注释）。
    <Card className="mb-4 break-inside-avoid md:mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DownloadIcon className="size-4" />
          버전 및 업데이트
        </CardTitle>
          <CardDescription>GitHub에서 새 버전을 확인하고 프로그램을 업데이트합니다. 업데이트 중 프로그램이 재시작될 수 있습니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">현재 버전</span>
          <Badge variant="secondary" className="font-mono">
            {info?.current ?? "…"}
          </Badge>
          {info && (
            <>
              <Badge variant="outline" className="font-mono">
                {info.os}/{info.arch}
              </Badge>
              <Badge variant="outline">{info.mode === "docker" ? "Docker" : "프로그램"}</Badge>
            </>
          )}
          {info?.latest && (
            <>
              <span className="text-muted-foreground">새 버전</span>
              <Badge variant={info.has_update ? "default" : "secondary"} className="font-mono">
                {info.latest}
              </Badge>
            </>
          )}
          {info?.html_url && (
            <a
              href={info.html_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              업데이트로그 <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>

        {info?.boot_notice && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {info.boot_notice}
          </p>
        )}

        {info?.error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            GitHub에 연결할 수 없습니다: {info.error}. 구성을 확인한 후 다시 시도해 주세요.
          </p>
        )}

        {info && !info.comparable && info.reason && <p className="text-xs text-muted-foreground">{info.reason}</p>}

        {info?.has_update && info.asset_available === false && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {info.latest}에 해당하는 {info.os}/{info.arch} 릴리스 패키지({info.asset})가 없어 자동 업데이트할 수 없습니다.
          </p>
        )}

        {info?.has_update && info.asset_available !== false && (
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{info.asset}</span>을 다운로드합니다.
            {info.size ? ` (${humanSize(info.size)})` : ""}. SHA256 검증에 실패하면 이전 버전을 유지합니다.
          </p>
        )}

        {info && !info.has_update && info.comparable && !info.error && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2Icon className="size-3.5 text-emerald-600" />
            최신 버전을 사용 중입니다.
          </p>
        )}

        {info?.mode === "docker" && info.has_update && (
          <p className="text-xs text-muted-foreground">
            Docker 환경에서는 프로그램만 업데이트되며 playwright, nmap 등의 도구는 업데이트되지 않습니다.
            <span className="font-mono"> docker compose up -d </span>
            도구를 업데이트하려면 다음 명령을 실행하세요:
            <span className="font-mono"> docker compose pull artex &amp;&amp; docker compose up -d artex</span>.
          </p>
        )}

        {showProgress && (
          <div className="space-y-1.5">
            <Progress value={pct} className={downloading ? undefined : "animate-pulse"} />
            <p className="text-xs text-muted-foreground">
              {restarting ? "새 버전으로 재시작 중입니다. 페이지가 자동으로 새로 고침됩니다…" : progress?.message}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => check(false)} disabled={checking || busy || restarting}>
            <RefreshCwIcon className={checking ? "size-4 animate-spin" : "size-4"} />
            업데이트 확인
          </Button>
          <Button
            size="sm"
            onClick={doUpdate}
            disabled={busy || restarting || !info?.has_update || info?.asset_available === false}
          >
            <DownloadIcon className="size-4" />
            {info?.has_update ? `${info.latest}(으)로 업데이트` : "업데이트"}
          </Button>
          {info?.has_backup && (
            <Button variant="ghost" size="sm" onClick={doRollback} disabled={busy || restarting}>
              <RotateCcwIcon className="size-4" />
              이전 버전으로 롤백
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          업데이트 스크립트로 프로그램을 재시작합니다. <span className="font-mono">start.sh</span>(Windows에서는
          <span className="font-mono"> start.bat</span>)를 사용하세요. ARTEX를 artex로 설치한 경우 프로그램이 자동으로 재시작되지 않을 수 있습니다.
        </p>
      </CardContent>
    </Card>
  );
}
