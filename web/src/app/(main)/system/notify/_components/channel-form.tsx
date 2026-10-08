"use client";

import { CheckIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { NotificationFilter } from "@/lib/types";

// asText / inputType 은本파일内의取值辅助（와控件渲染强相关），않음放에서 channel-fields。
import { type FieldDef, type FieldKind, SEVERITY_OPTIONS } from "./channel-fields";

// asText 把任意구성值渲染成입력框可用의문자열。
// config 来自 JSON，值可能은 string / number / boolean / array / null，
// 这里只关心「能할 수 없음塞进文本框」，具体序列化由 buildConfig 负责。
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

// inputType 把字段유형映射到 input 의 type 属性。
function inputType(kind: FieldKind): "text" | "password" | "number" {
  if (kind === "password") return "password";
  if (kind === "number") return "number";
  return "text";
}

// ConfigField 按字段定义渲染对应의控件。
//
// 掩码字段의处理은这里唯一의讲究：입력框**않음显示**掩码值本身，只显示一줄
// 「已저장」提示。这样界面上就只있음한 개규칙——框里있음字就은사용자填의，
// 空框就은空值。若把 "__masked__:…abc123" 塞进입력框，사용자会以을 위해那은要自己
// 删掉의占位文本，反而更容易误清凭据。
export function ConfigField({
  def,
  value,
  isSecret,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  isSecret: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `n-cfg-${def.key}`;
  const raw = asText(value);
  // 后端回显의掩码值：形如 "__masked__:…abc123"，尾部은原值의可辨识片段。
  const masked = isSecret && raw.startsWith("__masked__");
  const maskedTail = masked ? (raw.split("…")[1] ?? "") : "";

  if (def.kind === "switch") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Switch checked={value === true} onCheckedChange={onChange} aria-label={def.label} />
        {def.label}
        {def.help && <span className="text-muted-foreground">({def.help})</span>}
      </div>
    );
  }

  if (def.kind === "select") {
    return (
      <div className="grid gap-2">
        <Label>{def.label}</Label>
        <Select value={raw || def.options?.[0]?.value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(def.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // 控件按字段유형分派。用 if 链而않음은嵌套三元，은因을 위해这里要区分四种控件，
  // 三层三元读起来已经要停下来数括号了。
  function control() {
    if (def.kind === "textarea" || def.kind === "kv") {
      return (
        <Textarea
          id={id}
          className="font-mono"
          placeholder={def.placeholder}
          value={masked ? "" : raw}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    if (def.kind === "list") {
      return (
        <Input
          id={id}
          value={Array.isArray(value) ? (value as string[]).join(", ") : raw}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
        />
      );
    }
    return (
      <Input
        id={id}
        className={def.kind === "text" ? "font-mono" : ""}
        type={inputType(def.kind)}
        placeholder={def.placeholder}
        value={masked ? "" : raw}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const hint = masked ? (
    <p className="text-muted-foreground flex items-center gap-1 text-xs">
      <CheckIcon className="size-3" />
      저장된 값{maskedTail ? ` (${maskedTail})` : ""} · 새 값을 입력하면 교체되고, 비워 두면 삭제됩니다.
    </p>
  ) : (
    def.help && <p className="text-muted-foreground text-xs">{def.help}</p>
  );

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{def.label}</Label>
      {control()}
      {hint}
    </div>
  );
}

// FilterSummary 把过滤개件摘要成一줄，让卡片않음用펼치기就能看출력这개渠道推什么。
export function FilterSummary({ filter }: { filter: NotificationFilter }) {
  const parts: string[] = [];
  if (filter.min_severity) {
    parts.push(SEVERITY_OPTIONS.find((o) => o.value === filter.min_severity)?.label ?? filter.min_severity);
  }
  if (filter.vulnclass_include?.length) parts.push(`유형 ${filter.vulnclass_include.length}개 포함`);
  if (filter.vulnclass_exclude?.length) parts.push(`유형 ${filter.vulnclass_exclude.length}개 제외`);
  if (filter.task_ids?.length) parts.push(`${filter.task_ids.length}개 작업`);
  if (filter.asset_ids?.length) parts.push(`${filter.asset_ids.length}개 자산`);
  if (filter.on_status_change) parts.push("상태");
  if (parts.length === 0) {
    return <p className="text-muted-foreground text-sm">모든 취약점</p>;
  }
  return <p className="text-muted-foreground text-sm">{parts.join(" · ")}</p>;
}
