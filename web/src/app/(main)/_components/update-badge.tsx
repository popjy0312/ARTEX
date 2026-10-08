"use client";

import * as React from "react";

import Link from "next/link";

import { ArrowUpCircleIcon } from "lucide-react";

import { api } from "@/lib/api";

/**
 * 顶栏의"있음새 버전"提示：整页加载时查一회，있음업데이트就에서버전号旁边亮출력来，
 * 点击直达시스템구성页의「버전 및 업데이트」卡片。
 *
 * 后端对 GitHub 의查询결과있음 30 분缓存，所以这里每회挂载都查一회은보안의
 * ——未认证의 GitHub API 只있음 60 회/시간/IP，없음那层缓存의话，多开几개标签页
 * 就会把配额耗光，이후真想업데이트反而查않음动。
 *
 * 查询실패一律静默：顶栏않음은报错의地方，사용자进설정页点「업데이트 확인」会看到原因。
 */
export function UpdateBadge() {
  const [latest, setLatest] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    api
      .checkUpdate()
      .then((r) => {
        // has_update 已经포함了"버전号可比较"의判断，开发构建않음会亮这개提示。
        if (alive && r.has_update && r.latest) setLatest(r.latest.replace(/^v(?=\d)/, ""));
      })
      .catch(() => {
        // 静默：没网 / GitHub 속도 제한都않음该에서顶栏弹오류。
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!latest) return null;

  return (
    <Link
      href="/system/settings"
      title={`새 버전 ${latest}을(를) 발견했습니다. 업데이트하려면 클릭하세요.`}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs transition-opacity hover:opacity-90"
    >
      {/* ：，됨，하도록표시。 */}
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-primary-foreground" />
      </span>
      <ArrowUpCircleIcon className="size-3.5" />
      <span className="hidden sm:inline">새 버전 {latest}</span>
      <span className="sm:hidden">새 버전</span>
    </Link>
  );
}
