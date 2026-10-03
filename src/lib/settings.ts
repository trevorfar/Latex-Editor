"use client";

import { useSyncExternalStore } from "react";
import { SETTINGS_KEY } from "./theme-script";

export interface Settings {
  theme: "system" | "light" | "dark";
  fontSize: number;
  lineWrapping: boolean;
  keymap: "default" | "vim";
  spellcheck: boolean;
  autocomplete: boolean;
  autoCompile: boolean;
  /** Milliseconds of idle typing before an auto-compile. */
  autoCompileDelay: number;
  stopOnFirstError: boolean;
  showFormatBar: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontSize: 14,
  lineWrapping: true,
  keymap: "default",
  spellcheck: true,
  autocomplete: true,
  autoCompile: true,
  autoCompileDelay: 1200,
  stopOnFirstError: false,
  showFormatBar: true,
};

const KEY = SETTINGS_KEY;
const listeners = new Set<() => void>();
let current: Settings = DEFAULT_SETTINGS;
let loaded = false;

function load(): Settings {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) current = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      // Private mode or blocked storage: defaults apply for this session.
    }
  }
  return current;
}

export function getSettings(): Settings {
  return load();
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...load(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not persisted; still applies for this session.
  }
  applyTheme(current.theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, load, () => DEFAULT_SETTINGS);
}

export function resolvedTheme(theme: Settings["theme"]): "light" | "dark" {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Settings["theme"]): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolvedTheme(theme);
}

/** Re-applies the theme when the OS preference changes and the setting is "system". */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (load().theme === "system") {
      applyTheme("system");
      listeners.forEach((l) => l());
    }
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useResolvedTheme(): "light" | "dark" {
  const settings = useSettings();
  return useSyncExternalStore(
    subscribe,
    () => resolvedTheme(settings.theme),
    () => "light",
  );
}
