"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-device preferences, kept in localStorage (they don't need to sync).

export interface Settings {
  /** Play the tutor's replies automatically. */
  autoplay: boolean;
  /** Speak Chinese slowly (~60% speed in replies, ~50% for a single word). */
  slowChinese: boolean;
  /** Show pinyin above characters. */
  showPinyin: boolean;
}

const DEFAULTS: Settings = { autoplay: true, slowChinese: true, showPinyin: true };
const KEY = "laoshi.settings.v1";
const listeners = new Set<() => void>();
let cached: Settings | null = null;

function read(): Settings {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    cached = { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}) };
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

function write(next: Settings) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage blocked: keep the setting for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((patch: Partial<Settings>) => write({ ...read(), ...patch }), []);
  return [settings, update];
}
