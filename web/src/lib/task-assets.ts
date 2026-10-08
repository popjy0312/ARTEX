import type { NewAssetType } from "@/lib/types";

const ASSET_TYPE_LABELS: Record<NewAssetType, string> = {
  app: "신청",
  endpoint: "인터페이스",
  ip: "IP",
  root_domain: "루트 도메인 이름",
  service: "서비스",
  subdomain: "하위 도메인 이름",
};

const TASK_ASSET_SOURCE_LABELS: Record<string, string> = {
  agent: "에이전트 검색",
  anchor: "칠판 앵커",
  api: "자산 API",
  company: "기업 제휴",
  legacy: "역사적 연관성",
  manual: "수동 추가",
  system: "시스템 종속성",
  task: "작업 초기화",
};

export function taskAssetTypeLabel(type: NewAssetType): string {
  return ASSET_TYPE_LABELS[type];
}

export function taskAssetSourceLabel(source: string): string {
  return TASK_ASSET_SOURCE_LABELS[source] ?? source;
}
