"use client";

import * as React from "react";

import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

// /： localStorage，，
//  issue #39——0.3.2  Ctrl+Enter  Enter ，
//
export type ChatSendMode = "enter" | "ctrl-enter";

export const CHAT_SEND_MODE_KEY = "artex_chat_send_mode";
export const DEFAULT_CHAT_SEND_MODE: ChatSendMode = "enter";

export const CHAT_SEND_MODE_OPTIONS: { value: ChatSendMode; label: string }[] = [
  { value: "enter", label: "Enter로 전송, Shift+Enter로 줄바꿈" },
  { value: "ctrl-enter", label: "Ctrl+Enter로 전송, Enter로 줄바꿈" },
];

function parseMode(raw: string | null): ChatSendMode {
  return raw === "ctrl-enter" || raw === "enter" ? raw : DEFAULT_CHAT_SEND_MODE;
}

// localStorage  storage ，
//  emit ，
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// ，Object.is ， useSyncExternalStore
function getSnapshot(): ChatSendMode {
  return parseMode(getLocalStorageValue(CHAT_SEND_MODE_KEY));
}

//  localStorage，，hydrate  getSnapshot
function getServerSnapshot(): ChatSendMode {
  return DEFAULT_CHAT_SEND_MODE;
}

export function useChatSendMode(): ChatSendMode {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setChatSendMode(mode: ChatSendMode) {
  setLocalStorageValue(CHAT_SEND_MODE_KEY, mode);
  for (const listener of listeners) listener();
}

// shouldSubmitOnKey
// isComposing / keyCode 229 ，，
// enter  Shift， 0.3.2 ——
// ctrl-enter  Ctrl  Cmd（macOS）
export function shouldSubmitOnKey(e: React.KeyboardEvent, mode: ChatSendMode): boolean {
  if (e.key !== "Enter") return false;
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return false;
  if (mode === "ctrl-enter") return e.ctrlKey || e.metaKey;
  return !e.shiftKey;
}
